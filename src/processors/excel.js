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
 * FIX (fidelidad de fecha/hora — julio 2026): el fix anterior resolvía
 * el desfase de un día para FECHA, pero dejaba dos problemas activos:
 *   1. ENRAMPE / RETIRO / SOLICITUD DE ENRAMPE seguían viajando como
 *      Date hasta el export, y export.js no las anclaba en UTC antes
 *      de escribirlas (a diferencia de FECHA) — SheetJS serializa
 *      cualquier Date usando sus componentes UTC, así que en una zona
 *      con offset negativo (UTC-6) el archivo final salía adelantado
 *      exactamente ese offset (ej. 23:45 → 05:45 del día siguiente).
 *   2. TEMP. ENRAMPE / TEMP. DESENRAMPE no tenían NINGUNA protección
 *      — ni la de FECHA ni ninguna otra — así que sufrían el mismo
 *      desfase sin que hubiera indicio alguno en el código.
 *
 * Causa raíz real: ninguna de estas columnas necesita interpretarse
 * como fecha en ningún punto del pipeline — solo necesitan copiarse.
 * Por eso, para las columnas listadas en RAW_TEXT_DATE_COLS
 * (core/constants.js), se hace una segunda lectura de la misma hoja
 * con `raw:false` — que le pide a SheetJS el texto ya formateado de la
 * celda (su propiedad `.w`, el mismo cálculo que usa Excel para
 * mostrarla, sin aritmética de zona horaria de por medio) — y ESE
 * texto, tal cual, reemplaza el valor Date que _fixExcelDateRow había
 * construido. Cero Date, cero parsing, cero reconstrucción para estas
 * columnas en el resto del pipeline (ver también export.js). El resto
 * de columnas de fecha/hora que no vienen de RUTEO NUEVO (CITA, HR.
 * DESPACHO, SALIDA DE CASETA — provienen de PDF/paste, no de esta
 * hoja) no se tocan.
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
 * Nombres de columna EN LA HOJA DE ORIGEN (no los nombres de export.js
 * de RAW_TEXT_DATE_COLS — esos son los del archivo final; aquí son los
 * headers reales de RUTEO NUEVO, ver COL_MAP en core/constants.js para
 * el mapeo entre ambos). FECHA es la única que además se recorta a
 * solo fecha (regla de negocio: la primera columna del archivo final
 * es fecha, no fecha+hora) — las demás se preservan completas,
 * incluyendo su hora.
 * @private
 */
const RAW_TEXT_SOURCE_COLS = ['FECHA', 'T.E', 'T.R', 'SOLICITUD', 'ENRAMPE', 'RETIRO'];

/**
 * Sobreescribe, para cada columna en RAW_TEXT_SOURCE_COLS, el valor de
 * `rows[i]` con el texto exacto que Excel muestra para esa celda (sin
 * pasar por Date). Ver nota de cabecera del módulo.
 * @private
 */
function _applyRawSourceDates(rows, rawTextRows) {
  rows.forEach((row, i) => {
    const src = rawTextRows[i];
    if (!src) return;
    RAW_TEXT_SOURCE_COLS.forEach(key => {
      const text = src[key];
      if (text === undefined || text === '') return;
      row[key] = key === 'FECHA'
        ? String(text).replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, '').trim()
        : String(text).trim();
    });
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

  // Segunda pasada, SOLO para las columnas de RAW_TEXT_SOURCE_COLS — ver
  // nota de cabecera "FIX (fidelidad de fecha/hora)". Misma hoja, mismo
  // orden de filas que `raw`, alineado por índice.
  const rawTextRows = XLSX.utils.sheet_to_json(wsRuteo, { defval: '', raw: false });
  _applyRawSourceDates(raw, rawTextRows);

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
