/**
 * processors/excel.js
 * Lectura del Excel macro: hoja RUTEO NUEVO (rutas del día) y hoja
 * CONCENTRADO FACTURAS (datos de facturación) si existe.
 *
 * AJUSTE (jul-2026 — FECHA del archivo final):
 *   El intento anterior de corregir la columna FECHA manipulaba el
 *   objeto Date que entrega `cellDates:true` (redondeo + lectura en
 *   UTC). Eso seguía sin ser confiable: un Date construido por SheetJS
 *   a partir de un serial de Excel es en sí mismo ambiguo (puede venir
 *   anclado en UTC, con un instante que no es exactamente medianoche
 *   por imprecisión de punto flotante) — cualquier operación sobre ese
 *   objeto hereda esa ambigüedad, sin importar qué tan cuidadosa sea.
 *
 *   La única forma de garantizar "copiar exactamente el mismo valor,
 *   sin ningún cálculo ni interpretación" es leer el TEXTO que Excel ya
 *   muestra en la celda — la propiedad `.w` de SheetJS (el valor
 *   formateado, idéntico a lo que ve un humano al abrir RUTEO NUEVO) —
 *   en vez de su valor numérico/Date interpretado. Se guarda en
 *   `row._FECHA_TEXT`, un campo NUEVO que NO reemplaza `row['FECHA']`
 *   (ese sigue siendo el Date que ya consume
 *   core/fiscal-calendar.js/merge.js para calcular SW/DIA — no se toca
 *   esa lógica). `_FECHA_TEXT` lo consume ÚNICAMENTE
 *   core/constants.js → COL_MAP['FECHA'], para el archivo final.
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

  // ── FECHA — texto EXACTO tal como lo muestra Excel (ver nota de
  // cabecera "AJUSTE (jul-2026 — FECHA del archivo final)"). Se busca
  // la columna FECHA en la fila de encabezados y se lee `.w` (valor
  // formateado) directamente de la celda cruda — nunca se pasa por un
  // objeto Date ni por ningún cálculo. row['FECHA'] (el Date que ya
  // usa fiscal-calendar.js/merge.js para SW/DIA) queda intacto.
  const headerRow  = XLSX.utils.sheet_to_json(wsRuteo, { header: 1 })[0] || [];
  const fechaColIdx = headerRow.findIndex(h => String(h || '').trim().toUpperCase() === 'FECHA');
  if (fechaColIdx > -1) {
    for (let i = 0; i < raw.length; i++) {
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: fechaColIdx });
      const cell = wsRuteo[addr];
      if (cell && cell.w) raw[i]['_FECHA_TEXT'] = String(cell.w).trim();
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
