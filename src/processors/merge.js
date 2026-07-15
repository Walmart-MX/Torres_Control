/**
 * processors/merge.js
 * MERGE ENGINE — cruza los datos de las cuatro fuentes (Excel/RUTEO,
 * PDFs, concentrado de facturas, panel de despacho) y produce
 * State.merged: el array que alimenta la tabla, el SVE y la exportación.
 *
 * [... comentarios previos sin cambios ...]
 *
 * FIX (automatización SW — post análisis arquitectónico): se agrega el
 * cálculo de _SW (Semana Walmart, calendario fiscal 4-5-4) por fila.
 * DECISIÓN: la fecha de referencia es row['FECHA'] — la columna A del
 * Excel RUTEO NUEVO, ya corregida de zona horaria por _fixExcelDateRow
 * en excel.js — NUNCA el reloj del equipo. Esto hace que la SW (y a
 * futuro, cualquier lógica de calendario fiscal) sea inmune a en qué
 * momento del día se ejecuta SmartDispatch: no importa si el usuario
 * procesa antes o después de medianoche, la SW siempre corresponde al
 * día operativo real que trae el Excel, no al instante de ejecución.
 * Si la fecha falta o cae fuera de los años fiscales configurados en
 * fiscal-calendar.js, la fila queda con _SW vacío y se advierte en
 * consola — no se detiene el merge del resto de las rutas.
 *
 * Dependencias:
 *   - State (core/state.js) — lee 5 propiedades, escribe State.merged
 *   - COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT, MAX_MARCH (core/constants.js)
 *   - FactCache (features/fact-cache.js) — fallback de facturas históricas
 *   - normOp (utils/format.js) — normaliza el nombre de operador para
 *     buscarlo en State.catalog
 *   - getFiscalWeek (core/fiscal-calendar.js) — calendario fiscal Walmart
 */
import { State } from '../core/state.js';
import { COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT, MAX_MARCH } from '../core/constants.js';
import { FactCache } from '../features/fact-cache.js';
import { normOp } from '../utils/format.js';
import { getFiscalWeek } from '../core/fiscal-calendar.js';
import { resolveExcelDate, dayNameEs } from '../utils/date.js';
/**
 * Resuelve row['FECHA'] a un objeto Date válido.
 *
 * FIX (root cause del bug donde SW/DIA quedaban vacíos): la primera
 * versión de este cálculo exigía `row['FECHA'] instanceof Date`, pero
 * export.js ya asume —desde antes de este cambio— que esa misma
 * columna puede no llegar como Date estricto (ver su propio fallback
 * `val instanceof Date ? val : new Date(val)` en el bloque DATE_COLS
 * de buildWorkbook). El chequeo estricto era más restrictivo que el
 * resto del sistema y fallaba en silencio. Se alinea aquí con el mismo
 * patrón de tolerancia ya probado en export.js para esta columna.
 * @private
 */
function _resolveFecha(row) {
  const raw = row['FECHA'];
  if (!raw && raw !== 0) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function runMerge() {
  if (!State.xlsData || State.pdfData.size === 0) return;
  State.merged = [];

  const usedPdfRows = new Set();

  for (const row of State.xlsData) {
    const ruta    = String(row[COL_RUTA]    || '').trim();
    const detteF  = String(row[COL_DETTE_F] || '').trim();
    const factXls = String(row[COL_FACT]    || '').trim();

    let pdfRow = null, pdfMatchType = 'none';
    if (factXls) { const r = State.pdfData.get(ruta + '|' + factXls); if (r && !usedPdfRows.has(r)) { pdfRow = r; pdfMatchType = 'specific'; } }
    if (!pdfRow && detteF) { const r = State.pdfData.get(ruta + '|D|' + detteF); if (r && !usedPdfRows.has(r)) { pdfRow = r; pdfMatchType = 'specific'; } }
    if (!pdfRow) {
      const detteE = String(row[COL_DETTE_E] || '').trim();
      if (detteE) { const r = State.pdfData.get(ruta + '|D|' + detteE); if (r && !usedPdfRows.has(r)) { pdfRow = r; pdfMatchType = 'specific'; } }
    }
    if (!pdfRow && ruta) {
      for (const [, v] of State.pdfData) { if (v.ruta === ruta && !usedPdfRows.has(v)) { pdfRow = v; pdfMatchType = 'fallback'; break; } }
    }
    if (pdfRow) usedPdfRows.add(pdfRow);

    const factKey = pdfRow ? String(pdfRow.factura || '').trim() : '';
    let   factRow = factKey ? (State.factData.get(factKey) || null) : null;
    let   factFromCache = false;
    if (!factRow && factKey) {
      const cached = FactCache.lookup(factKey);
      if (cached) { factRow = cached; factFromCache = true; }
    }
    const despRow = ruta ? (State.despData.get(ruta) || null) : null;

    const _rowId = ruta + '||' + (detteF || String(State.merged.length));
    const nr = { ...row, _rowId, _matched: !!pdfRow, _factMatched: !!factRow, _despMatched: !!despRow };

// ── SW (calendario fiscal Walmart) + DIA — ambas derivadas de
    // row['FECHA'], nunca del reloj del equipo. resolveExcelDate()
    // (utils/date.js) es la única fuente de verdad para interpretar
    // row['FECHA'] sin ambigüedad de formato — ver su cabecera.
    const fechaRef = resolveExcelDate(row['FECHA']);
    let sw = '', dia = '';
    if (fechaRef) {
      dia = dayNameEs(fechaRef);
      try {
        sw = getFiscalWeek(fechaRef).sw;
      } catch (e) {
        console.warn('[merge] SW no calculada para ruta', ruta, '—', e.message);
      }
    } else {
      console.warn('[merge] FECHA no resoluble para ruta', ruta, '— SW y DIA quedarán vacíos.');
    }
    nr['_SW']  = sw;
    nr['_DIA'] = dia;

    if (pdfRow) {
      nr['OPERADOR'] = pdfRow.operador;
      nr['TARIMAS']  = parseInt(pdfRow.tarimas, 10) || pdfRow.tarimas;
      for (let m = 0; m < MAX_MARCH; m++) nr['MARCHAMO ' + (m + 1)] = pdfRow.marchamos[m] || '';
      nr['FAC_PDF']      = pdfRow.factura;
      nr['DEST_PDF']     = pdfRow.destino;
      nr['_CITA_PDF']    = (pdfMatchType === 'specific' && pdfRow.cita) ? pdfRow.cita : '';
      nr['CITA']         = nr['_CITA_PDF'];
      nr['_LIC']         = State.catalog.get(normOp(pdfRow.operador)) || '';
      nr['_HR_DESP_PDF'] = pdfRow.hrDespacho || '';
    } else {
      nr['OPERADOR'] = '';
      nr['TARIMAS']  = '';
      for (let m = 0; m < MAX_MARCH; m++) nr['MARCHAMO ' + (m + 1)] = '';
      nr['_CITA_PDF'] = ''; nr['CITA'] = ''; nr['_LIC'] = ''; nr['_HR_DESP_PDF'] = '';
    }

    if (factRow) {
      nr['_GLS']           = factRow.gls;
      nr['_HORA_FACT']     = factRow.horaFact;
      nr['_factSource']    = factFromCache ? 'cache' : 'current';
      nr['_factCacheDate'] = factFromCache ? (factRow.date || '') : '';
    } else {
      nr['_GLS'] = ''; nr['_HORA_FACT'] = ''; nr['_factSource'] = ''; nr['_factCacheDate'] = '';
    }

    if (despRow) { nr['_HR_DESP'] = despRow.hrDesp; nr['_CASETA'] = despRow.caseta; nr['_WTMS'] = despRow.wtms; nr['_ID_IDA'] = despRow.idIda; }
    else         { nr['_HR_DESP'] = ''; nr['_CASETA'] = ''; nr['_WTMS'] = ''; nr['_ID_IDA'] = ''; }

    State.merged.push(nr);
  }
}
