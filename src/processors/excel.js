/**
 * processors/excel.js
 * Lectura del Excel macro: hoja RUTEO NUEVO (rutas del día) y hoja
 * CONCENTRADO FACTURAS (datos de facturación) si existe.
 *
 * DIAGNÓSTICO TEMPORAL (jul-2026 — FECHA del archivo final):
 *   Después de tres intentos con el mismo resultado erróneo exacto
 *   (06/05/2028), la explicación más probable es que la detección de
 *   la columna FECHA en el encabezado NUNCA está encontrando la
 *   columna (fechaColIdx = -1) — lo que significa que _FECHA_DMY y
 *   _FECHA_TEXT nunca se llegan a asignar, y el archivo final sigue
 *   cayendo en el camino ORIGINAL (el que ya tenía el bug desde el
 *   principio), sin importar cuántas veces se cambie la lógica de
 *   parseo — porque esa lógica nunca se ejecuta.
 *
 *   Este archivo agrega un console.log TEMPORAL que imprime:
 *     - El encabezado completo detectado (headerRow)
 *     - El índice de columna encontrado para "FECHA" (fechaColIdx)
 *     - La celda cruda (tipo, valor, texto formateado) de la primera
 *       fila de datos en esa columna
 *
 *   INSTRUCCIONES: carga tu Excel como siempre, abre la consola del
 *   navegador (F12 → pestaña "Console") ANTES de soltar el archivo, y
 *   copia/pega aquí el bloque que empieza con "[FECHA DEBUG]". Con eso
 *   sabremos con certeza qué está pasando, en vez de seguir adivinando.
 *   Este bloque de diagnóstico se retira en cuanto se confirme la causa.
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

  // ── FECHA — con diagnóstico temporal (ver nota de cabecera). ──
  const headerRow   = XLSX.utils.sheet_to_json(wsRuteo, { header: 1 })[0] || [];
  const fechaColIdx = headerRow.findIndex(h => String(h || '').trim().toUpperCase() === 'FECHA');

  // ─────────────────────────────────────────────────────────────
  // [FECHA DEBUG] — bloque temporal, retirar cuando se confirme la causa
  console.log('[FECHA DEBUG] Hoja detectada como RUTEO NUEVO:', ruteoName);
  console.log('[FECHA DEBUG] headerRow completo:', headerRow);
  console.log('[FECHA DEBUG] fechaColIdx encontrado:', fechaColIdx);
  if (fechaColIdx > -1) {
    const addr0 = XLSX.utils.encode_cell({ r: 1, c: fechaColIdx });
    const cell0 = wsRuteo[addr0];
    console.log('[FECHA DEBUG] addr primera fila de datos:', addr0);
    console.log('[FECHA DEBUG] celda cruda completa:', cell0);
    console.log('[FECHA DEBUG]   cell.t (tipo):', cell0 && cell0.t);
    console.log('[FECHA DEBUG]   cell.v (valor crudo):', cell0 && cell0.v);
    console.log('[FECHA DEBUG]   cell.w (texto formateado):', cell0 && cell0.w);
  } else {
    console.log('[FECHA DEBUG] ⚠ No se encontró "FECHA" en el encabezado — por eso el fix nunca se aplica.');
  }
  console.log('[FECHA DEBUG] raw[0][\'FECHA\'] (lo que ya lee sheet_to_json normal):', raw[0] && raw[0]['FECHA']);
  console.log('[FECHA DEBUG] typeof raw[0][\'FECHA\']:', raw[0] && typeof raw[0]['FECHA']);
  // ─────────────────────────────────────────────────────────────

  if (fechaColIdx > -1) {
    for (let i = 0; i < raw.length; i++) {
      const addr = XLSX.utils.encode_cell({ r: i + 1, c: fechaColIdx });
      const cell = wsRuteo[addr];
      if (!cell) continue;
      if (cell.t === 'n' && typeof cell.v === 'number') {
        const dc = XLSX.SSF.parse_date_code(cell.v);
        if (dc) raw[i]['_FECHA_DMY'] = { dd: dc.d, mm: dc.m, yyyy: dc.y };
      } else if (cell.w) {
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
