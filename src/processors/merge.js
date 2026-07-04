/**
 * processors/merge.js
 * MERGE ENGINE — cruza los datos de las cuatro fuentes (Excel/RUTEO,
 * PDFs, concentrado de facturas, panel de despacho) y produce
 * State.merged: el array que alimenta la tabla, el SVE y la exportación.
 *
 * A diferencia de pdf.js / excel.js / paste.js, esta función NO es pura:
 * lee State.xlsData, State.pdfData, State.factData, State.despData,
 * State.catalog directamente, y escribe el resultado en State.merged.
 * Es intencional — preserva exactamente el comportamiento original.
 *
 * Estrategia de match PDF (en orden de prioridad):
 *   1. ruta + factura del Excel (match específico)
 *   2. ruta + DETTE.1 del Excel (match específico)
 *   3. ruta + DETTE del Excel (match específico)
 *   4. cualquier PDF con la misma ruta (fallback, primera coincidencia)
 *
 * Estrategia de match de factura:
 *   1. State.factData (concentrado del Excel recién cargado)
 *   2. FactCache.lookup() como fallback (concentrado de días anteriores)
 *
 * Dependencias:
 *   - State (core/state.js) — lee 5 propiedades, escribe State.merged
 *   - COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT, MAX_MARCH (core/constants.js)
 *   - FactCache (features/fact-cache.js) — fallback de facturas históricas
 *   - normOp (utils/format.js) — normaliza el nombre de operador para
 *     buscarlo en State.catalog
 */
import { State } from '../core/state.js';
import { COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT, MAX_MARCH } from '../core/constants.js';
import { FactCache } from '../features/fact-cache.js';
import { normOp } from '../utils/format.js';

/**
 * Ejecuta el merge completo. No hace nada si falta el Excel o no hay
 * ningún PDF cargado (guard clause idéntica al original).
 * Efecto secundario: reemplaza State.merged con el resultado del cruce.
 */
export function runMerge() {
  if (!State.xlsData || State.pdfData.size === 0) return;
  State.merged = [];

  for (const row of State.xlsData) {
    const ruta    = String(row[COL_RUTA]    || '').trim();
    const detteF  = String(row[COL_DETTE_F] || '').trim();
    const factXls = String(row[COL_FACT]    || '').trim();

    let pdfRow = null, pdfMatchType = 'none';
    if (factXls) { const r = State.pdfData.get(ruta + '|' + factXls); if (r) { pdfRow = r; pdfMatchType = 'specific'; } }
    if (!pdfRow && detteF) { const r = State.pdfData.get(ruta + '|D|' + detteF); if (r) { pdfRow = r; pdfMatchType = 'specific'; } }
    if (!pdfRow) {
      const detteE = String(row[COL_DETTE_E] || '').trim();
      if (detteE) { const r = State.pdfData.get(ruta + '|D|' + detteE); if (r) { pdfRow = r; pdfMatchType = 'specific'; } }
    }
    if (!pdfRow && ruta) {
      for (const [, v] of State.pdfData) { if (v.ruta === ruta) { pdfRow = v; pdfMatchType = 'fallback'; break; } }
    }

    const factKey = pdfRow ? String(pdfRow.factura || '').trim() : '';
    let   factRow = factKey ? (State.factData.get(factKey) || null) : null;
    let   factFromCache = false;
    if (!factRow && factKey) {
      const cached = FactCache.lookup(factKey);
      if (cached) { factRow = cached; factFromCache = true; }
    }
    const despRow = ruta ? (State.despData.get(ruta) || null) : null;

    // _rowId: stable unique key — RUTA + delivery sub-key (DETTE.1).
    // Multiple rows sharing the same RUTA but different destinations remain
    // distinguishable. EditSystem uses this ID as the canonical pointer to
    // guarantee it mutates exactly the right object in State.merged.
    const _rowId = ruta + '||' + (detteF || String(State.merged.length));
    const nr = { ...row, _rowId, _matched: !!pdfRow, _factMatched: !!factRow, _despMatched: !!despRow };

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
