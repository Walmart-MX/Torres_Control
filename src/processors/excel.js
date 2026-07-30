/**
 * processors/excel.js
 * Lectura del Excel macro: hoja RUTEO NUEVO (rutas del día) y hoja
 * CONCENTRADO FACTURAS (datos de facturación) si existe.
 *
 * AJUSTE (jul-2026 — FECHA del archivo final, TERCER intento):
 *   Intento 1: manipular el objeto Date de `cellDates:true` (redondeo +
 *   lectura UTC) — seguía ambiguo porque ese Date ya nace ambiguo.
 *   Intento 2: usar el texto formateado `.w` de la celda (ej.
 *   "29/07/2026") asumiendo orden DÍA/MES — resultó ser el problema
 *   real: `.w` lo genera SheetJS a partir del CÓDIGO de formato guardado
 *   en el archivo (ej. "m/d/yyyy"), que muchas veces está en inglés
 *   (mes/día) aunque Excel lo muestre en pantalla como día/mes según el
 *   regional del sistema — SheetJS no hace esa relocalización, así que
 *   asumir un orden fijo era una apuesta que a veces perdía (mes
 *   inválido → JavaScript "rodaba" el calendario meses/años hacia
 *   adelante, el bug que se vio con la fecha saltando a 2028).
 *
 *   AHORA (intento 3, definitivo): se lee el número de serie CRUDO de
 *   la celda (`cell.v`, un entero/decimal sin ninguna interpretación de
 *   texto ni de zona horaria) y se decodifica con
 *   `XLSX.SSF.parse_date_code()` — la misma función interna que usa
 *   SheetJS para construir los objetos Date de `cellDates:true`, pero
 *   aquí se usa DIRECTO, devolviendo {y, m, d} sin pasar nunca por un
 *   objeto Date de JavaScript. Cero ambigüedad de zona horaria, cero
 *   ambigüedad de orden día/mes (el serial de Excel no tiene orden —
 *   es un conteo de días, no texto). Se guarda en
 *   `row._FECHA_DMY = { dd, mm, yyyy }`.
 *
 *   Si la celda NO es numérica (fue capturada como texto puro en el
 *   Excel), se guarda además `row._FECHA_TEXT` como respaldo de mejor
 *   esfuerzo — ver core/constants.js / features/export.js.
 *   `row['FECHA']` (el Date que usa fiscal-calendar.js/merge.js para
 *   SW/DIA) no se toca — sigue igual que siempre.
 *
 * Dependencias:
 *   - XLSX (SheetJS, cargado globalmente desde el CDN en index.html)
 *   - SHEET_RUTEO, SHEET_FACTURAS (core/constants.js) — nombres alternativos
 *     de hoja que se buscan por coincidencia parcial, insensible a mayúsculas
 *   - formatFactDate (utils/format.js) — normaliza el valor de la celda de
 *     fecha de facturación (puede venir como Date, número serial o string)
 */
import { SHEET_RUTEO, SHEET_FACTURAS } from '../core/constants.js';
import { formatFactDate } from '../utils/format.js';

/**
 * Lee el archivo Excel y extrae:
 *   - rows: array de rows de la hoja RUTEO NUEVO (o la primera hoja si no
 *     se encuentra un nombre coincidente)
 *   - factData: Map invoice# → { gls, horaFact }, leído de la hoja
 *     CONCENTRADO FACTURAS si existe y tiene una columna de invoice
 *     reconocible (INVOICE / FACTURA / FOLIO)
 *
 * @param {File} file
 * @returns {Promise<{
 *   rows: Array<object>,
 *   factData: Map<string, {gls:string, horaFact:string}>,
 *   ruteoName: string,
 *   factSheetLabel: string
 * }>}
 */
export async function processXLS(file) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array', cellDates: true });

  const ruteoName = wb.SheetNames.find(n =>
    SHEET_RUTEO.some(s => n.toUpperCase().includes(s.toUpperCase()))
  ) || wb.SheetNames[0];
  const wsRuteo = wb.Sheets[ruteoName];
  const raw     = XLSX.utils.sheet_to_json(wsRuteo, { defval: '' });

  // ── FECHA — decodificada del serial crudo de la celda (ver nota de
  // cabecera "AJUSTE (jul-2026 — FECHA del archivo final, TERCER
  // intento)"). Se ubica la columna FECHA en el encabezado y se lee
  // `cell.v`/`cell.t` directo de la celda cruda del worksheet — nunca
  // el texto formateado, nunca un objeto Date.
  const headerRow   = XLSX.utils.sheet_to_json(wsRuteo, { header: 1 })[0] || [];
  const fechaColIdx = headerRow.findIndex(h => String(h || '').trim().toUpperCase() === 'FECHA');
  if (fechaColIdx > -1) {
    for (let i = 0; i < raw.length; i++) {
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: fechaColIdx });
      const cell = wsRuteo[addr];
      if (!cell) continue;
      if (cell.t === 'n' && typeof cell.v === 'number') {
        // Celda de fecha real (serial numérico de Excel) — se decodifica
        // con el propio algoritmo de SheetJS (ya resuelve el bug del año
        // 1900 de Excel), sin texto localizado y sin objeto Date.
        const dc = XLSX.SSF.parse_date_code(cell.v);
        if (dc) raw[i]['_FECHA_DMY'] = { dd: dc.d, mm: dc.m, yyyy: dc.y };
      } else if (cell.w) {
        // Respaldo — la celda no es numérica (texto capturado a mano).
        // Se guarda el texto tal cual para intentar parsearlo en el
        // export (ver features/export.js), mejor esfuerzo.
        raw[i]['_FECHA_TEXT'] = String(cell.w).trim();
      }
    }
  }

  const factName = wb.SheetNames.find(n =>
    SHEET_FACTURAS.some(s => n.toUpperCase().includes(s.toUpperCase()))
  );
  const newFactData = new Map();
  let factSheetLabel = '';

  if (factName) {
    const wsFact  = wb.Sheets[factName];
    const rawFact = XLSX.utils.sheet_to_json(wsFact, { defval: '' });
    const keys    = Object.keys(rawFact[0] || {});
    const colInv  = keys.find(k => /INVOICE|FACTURA|FOLIO/i.test(k));
    const colLoad = keys.find(k => /LOAD|GLS/i.test(k));
    const colFin  = keys.find(k => /FINAL|HORA|FACTURACION|TS/i.test(k));
    if (colInv) {
      for (const r of rawFact) {
        const inv = String(r[colInv] || '').trim();
        if (!inv) continue;
        newFactData.set(inv, {
          gls:      colLoad ? String(r[colLoad] || '').trim() : '',
          horaFact: colFin  ? formatFactDate(r[colFin])        : ''
        });
      }
      factSheetLabel = `${newFactData.size} facturas (${factName})`;
    } else {
      factSheetLabel = 'hoja facturas sin columna INVOICE';
    }
  } else {
    factSheetLabel = `sin hoja CONCENTRADO FACTURAS`;
  }

  return { rows: raw, factData: newFactData, ruteoName, factSheetLabel };
}
