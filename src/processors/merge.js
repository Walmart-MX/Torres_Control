/**
 * processors/merge.js
 * MERGE ENGINE — cruza los datos de las cuatro fuentes obligatorias
 * (Excel/RUTEO, PDFs, Status de despacho, Reporte WTMS) y produce
 * State.merged.
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   runMerge() solo se invoca cuando Events.checkSources() confirmó que
 *   las 4 fuentes están completas (ver events/events.js).
 *
 *   Cruce: Status.ID'S MASTER (despRow.idIda) == WTMS.ID de la carga
 *   (clave del Map State.wtmsData, armado por processors/wtms.js).
 *
 *   Reglas de negocio (confirmadas con EduarDo):
 *     - Match: ID RETORNO = WTMS.Siguiente Carga, CARTA PORTE = WTMS.Carte Porte.
 *     - Sin match (había ID'S MASTER pero no se encontró): ID RETORNO='N/A',
 *       CARTA PORTE='' — incidencia ADVERTENCIA en SVE ('no_wtms').
 *     - Doble dato (coma, ej. "1234,4321"): _wtmsAmbiguous=true —
 *       incidencia CRÍTICA en SVE ('wtms_ambiguous'), bloquea
 *       exportación hasta resolución manual vía drawer de edición.
 */

import { State } from '../core/state.js';
import { COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT, MAX_MARCH } from '../core/constants.js';
import { FactCache } from '../features/fact-cache.js';
import { normOp } from '../utils/format.js';
import { getFiscalWeek } from '../core/fiscal-calendar.js';
import { resolveExcelDate, dayNameEs } from '../utils/date.js';
import { buildIndices, enrichRow } from '../features/catalogs/enrichment-engine.js';
import { computeTimes } from '../core/time-engine.js';

function _resolveFecha(row) {
  const raw = row['FECHA'];
  if (!raw && raw !== 0) return null;
  const d = raw instanceof Date ? raw : new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function runMerge() {

  if (!State.xlsData || State.pdfData.size === 0) return;

  State.merged = [];

  const {
    indices: catalogIndices,
    duplicates: catalogDuplicates
  } = buildIndices(State.catalogs || {});

  State.catalogIndices = catalogIndices;
  State.catalogDuplicates = catalogDuplicates;

  const usedPdfRows = new Set();

  for (const row of State.xlsData) {

    const ruta    = String(row[COL_RUTA] || '').trim();
    const detteF  = String(row[COL_DETTE_F] || '').trim();
    const factXls = String(row[COL_FACT] || '').trim();

    let pdfRow = null;
    let pdfMatchType = 'none';

    if (factXls) {
      const r = State.pdfData.get(ruta + '|' + factXls);
      if (r && !usedPdfRows.has(r)) { pdfRow = r; pdfMatchType = 'specific'; }
    }

    if (!pdfRow && detteF) {
      const r = State.pdfData.get(ruta + '|D|' + detteF);
      if (r && !usedPdfRows.has(r)) { pdfRow = r; pdfMatchType = 'specific'; }
    }

    if (!pdfRow) {
      const detteE = String(row[COL_DETTE_E] || '').trim();
      if (detteE) {
        const r = State.pdfData.get(ruta + '|D|' + detteE);
        if (r && !usedPdfRows.has(r)) { pdfRow = r; pdfMatchType = 'specific'; }
      }
    }

    if (!pdfRow && ruta) {
      for (const [, v] of State.pdfData) {
        if (v.ruta === ruta && !usedPdfRows.has(v)) { pdfRow = v; pdfMatchType = 'fallback'; break; }
      }
    }

    if (pdfRow) usedPdfRows.add(pdfRow);

    const factKey = pdfRow ? String(pdfRow.factura || '').trim() : '';
    let factRow = factKey ? (State.factData.get(factKey) || null) : null;
    let factFromCache = false;

    if (!factRow && factKey) {
      const cached = FactCache.lookup(factKey);
      if (cached) { factRow = cached; factFromCache = true; }
    }

    const despRow = ruta ? (State.despData.get(ruta) || null) : null;
    const _rowId = ruta + '||' + (detteF || String(State.merged.length));

    const nr = {
      ...row,
      _rowId,
      _matched: !!pdfRow,
      _factMatched: !!factRow,
      _despMatched: !!despRow
    };

    const fechaRef = resolveExcelDate(row['FECHA']);
    let sw = '', dia = '';

    if (fechaRef) {
      dia = dayNameEs(fechaRef);
      try { sw = getFiscalWeek(fechaRef).sw; }
      catch (e) { console.warn('[merge] SW no calculada para ruta', ruta, '—', e.message); }
    } else {
      console.warn('[merge] FECHA no resoluble para ruta', ruta, '— SW y DIA quedarán vacíos.');
    }

    nr['_SW']  = sw;
    nr['_DIA'] = dia;

    if (pdfRow) {
      nr['OPERADOR'] = pdfRow.operador;
      nr['TARIMAS']  = parseInt(pdfRow.tarimas, 10) || pdfRow.tarimas;
      for (let m = 0; m < MAX_MARCH; m++) nr['MARCHAMO ' + (m + 1)] = pdfRow.marchamos[m] || '';
      nr['FAC_PDF']   = pdfRow.factura;
      nr['DEST_PDF']  = pdfRow.destino;
      nr['_CITA_PDF'] = (pdfMatchType === 'specific' && pdfRow.cita) ? pdfRow.cita : '';
      nr['CITA']      = nr['_CITA_PDF'];
      nr['_LIC']      = State.catalog.get(normOp(pdfRow.operador)) || '';
      nr['_HR_DESP_PDF'] = pdfRow.hrDespacho || '';
    } else {
      nr['OPERADOR'] = '';
      nr['TARIMAS']  = '';
      for (let m = 0; m < MAX_MARCH; m++) nr['MARCHAMO ' + (m + 1)] = '';
      nr['_CITA_PDF'] = '';
      nr['CITA']      = '';
      nr['_LIC']      = '';
      nr['_HR_DESP_PDF'] = '';
    }

    if (factRow) {
      nr['_GLS']           = factRow.gls;
      nr['_HORA_FACT']     = factRow.horaFact;
      nr['_factSource']    = factFromCache ? 'cache' : 'current';
      nr['_factCacheDate'] = factFromCache ? (factRow.date || '') : '';
    } else {
      nr['_GLS'] = ''; nr['_HORA_FACT'] = ''; nr['_factSource'] = ''; nr['_factCacheDate'] = '';
    }

    if (despRow) {
      nr['_HR_DESP'] = despRow.hrDesp;
      nr['_CASETA']  = despRow.caseta;
      nr['_WTMS']    = despRow.wtms;
      nr['_ID_IDA']  = despRow.idIda;
    } else {
      nr['_HR_DESP'] = ''; nr['_CASETA'] = ''; nr['_WTMS'] = ''; nr['_ID_IDA'] = '';
    }

    // ── NUEVO — Reporte WTMS (4ª fuente obligatoria) ──
    const idMaster  = despRow ? String(despRow.idIda || '').trim() : '';
    const wtmsMatch = idMaster ? (State.wtmsData.get(idMaster) || null) : null;

    if (idMaster && wtmsMatch) {
      const retorno = String(wtmsMatch.siguienteCarga || '').trim();
      const carta   = String(wtmsMatch.carteporte || '').trim();
      nr['_ID_RETORNO']    = retorno;
      nr['_CARTA_PORTE']   = carta;
      nr['_wtmsMatched']   = true;
      nr['_wtmsAmbiguous'] = retorno.includes(',') || carta.includes(',');
    } else if (idMaster && !wtmsMatch) {
      nr['_ID_RETORNO']    = 'N/A';
      nr['_CARTA_PORTE']   = '';
      nr['_wtmsMatched']   = false;
      nr['_wtmsAmbiguous'] = false;
    } else {
      nr['_ID_RETORNO']    = '';
      nr['_CARTA_PORTE']   = '';
      nr['_wtmsMatched']   = null;
      nr['_wtmsAmbiguous'] = false;
    }

    nr['_enrichMisses'] = enrichRow(nr, row, catalogIndices);
    nr['_timeAnomalies'] = computeTimes(nr);

    State.merged.push(nr);
  }
}
