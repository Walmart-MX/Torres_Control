/**
 * processors/excel.js
 * Lectura del Excel macro: hoja RUTEO NUEVO (rutas del día) y hoja
 * CONCENTRADO FACTURAS (datos de facturación) si existe.
 *
 * FIX (auditoría post-Camino B): _fixExcelDateRow() — SheetJS
 * (cellDates:true) construye los Date de celdas de fecha usando UTC
 * medianoche (Date.UTC(y,m,d)). El resto de la app lee esos objetos con
 * métodos LOCALES (getFullYear/getMonth/getDate, usados en
 * features/export.js al armar la columna FECHA). En una zona horaria con
 * offset negativo (México, UTC-6), el objeto "retrocede" al día
 * anterior — la columna FECHA salía con un día menos que el real. Se
 * reconstruye cada Date usando sus propios componentes UTC como si
 * fueran locales, así el resto de la app (que ya asume fechas locales)
 * los lee correctamente. Se aplica a ambas hojas por robustez — cualquier
 * columna de fecha en cualquiera de las dos sufre el mismo bug de SheetJS.
 *
 * FIX (fidelidad de FECHA — julio 2026): el fix anterior resolvía el
 * desfase de un día, pero FECHA seguía viajando como objeto Date —
 * reconstruido 3 veces en total entre excel.js, la vista previa (ui.js
 * → fmtDate) y export.js. Cada reconstrucción es una oportunidad de
 * fuga: redondeo de punto flotante en el número serial de Excel,
 * supuestos de zona horaria, y en el caso de `new Date(string)` en
 * export.js, ambigüedad real DD/MM vs MM/DD para días ≤ 12.
 *
 * Causa raíz: FECHA no necesita ser interpretada como fecha en ningún
 * punto del pipeline — solo necesita copiarse. Por eso, además de
 * `raw` (con cellDates:true, usado para TODAS las demás columnas de
 * fecha/hora que sí lo requieren: ENRAMPE, RETIRO, SOLICITUD DE
 * ENRAMPE, TEMP. ENRAMPE/DESENRAMPE), se hace una segunda pasada
 * `raw:false` sobre la MISMA hoja — que le pide a SheetJS el texto ya
 * formateado de la celda (su propiedad `.w`, el mismo cálculo de
 * calendario que usa Excel para mostrarla, sin aritmética de zona
 * horaria de por medio) — y se usa ESE texto, tal cual, como el valor
 * de FECHA. Cero Date, cero parsing, cero reconstrucción en el resto
 * del pipeline para esta columna específica (ver también export.js).
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
 * Corrige el desfase de zona horaria de SheetJS: reconstruye cualquier
 * valor Date de la fila usando sus componentes UTC como si fueran
 * locales. Ver nota de cabecera del módulo.
 * @private
 */
function _fixExcelDateRow(row) {
  const fixed = { ...row };
  for (const key of Object.keys(fixed)) {
    const val = fixed[key];
    if (val instanceof Date && !isNaN(val.getTime())) {
      fixed[key] = new Date(
        val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate(),
        val.getUTCHours(), val.getUTCMinutes(), val.getUTCSeconds()
      );
    }
  }
  return fixed;
}

/**
 * Sobreescribe row.FECHA con el texto exacto que Excel muestra para esa
 * celda (sin pasar por Date). Recorta un posible sufijo de hora si la
 * celda de origen trae fecha+hora pegadas — operación de texto pura,
 * no interpreta ni reformatea la fecha en sí.
 * @private
 */
function _applyRawFecha(rows, rawTextRows) {
  rows.forEach((row, i) => {
    const srcText = rawTextRows[i] ? rawTextRows[i]['FECHA'] : undefined;
    if (srcText === undefined || srcText === '') return;
    row['FECHA'] = String(srcText).replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, '').trim();
  });
}

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
  const raw     = XLSX.utils.sheet_to_json(wsRuteo, { defval: '' }).map(_fixExcelDateRow);

  // Segunda pasada, SOLO para FECHA — ver nota de cabecera "FIX (fidelidad
  // de FECHA)". Misma hoja, mismo orden de filas que `raw`, alineado por
  // índice.
  const rawTextRows = XLSX.utils.sheet_to_json(wsRuteo, { defval: '', raw: false });
  _applyRawFecha(raw, rawTextRows);

  const factName = wb.SheetNames.find(n =>
    SHEET_FACTURAS.some(s => n.toUpperCase().includes(s.toUpperCase()))
  );
  const newFactData = new Map();
  let factSheetLabel = '';

  if (factName) {
    const wsFact  = wb.Sheets[factName];
    const rawFact = XLSX.utils.sheet_to_json(wsFact, { defval: '' }).map(_fixExcelDateRow);
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
