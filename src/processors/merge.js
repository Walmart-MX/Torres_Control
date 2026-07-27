/**
 * processors/merge.js
 * MERGE ENGINE — cruza los datos de las cuatro fuentes (Excel/RUTEO,
 * PDFs, concentrado de facturas, panel de despacho) y produce
 * State.merged: el array que alimenta la tabla, el SVE y la exportación.
 *
 * A diferencia de pdf.js / excel.js / paste.js, esta función NO es pura:
 * lee State.xlsData, State.pdfData, State.factData, State.despData,
 * State.catalog, State.catalogs, State.wtmsData directamente, y escribe
 * el resultado en State.merged. Es intencional — preserva exactamente
 * el comportamiento original.
 *
 * FIX (jul-2026) — motores existentes que nunca se invocaban:
 *   Tres módulos ya escritos y correctos (enrichment-engine.js,
 *   fiscal-calendar.js) más el cruce con el Reporte WTMS nunca se
 *   llamaban desde aquí — el loop solo resolvía PDF/factura/despacho.
 *   Efecto observable: FORMATO/TIENDA/ESTADO/NOMBRE (Ventana de Recibo),
 *   LINEA/PLACA TRACTOR/ESQUEMA/PLACA REMOLQUE/CAP. (Pool Real),
 *   DIA/SW (calendario fiscal) y CARTA PORTE/ID RETORNO (cruce WTMS)
 *   salían siempre vacíos en el Excel final, aunque COL_MAP (constants.js)
 *   ya esperaba sus resultados en nr['_SW'], nr['_CARTA_PORTE'], etc.
 *   Se agrega también la llamada a computeTimes() (core/time-engine.js),
 *   con el mismo problema: nunca se ejecutaba, así que TIEMPO ENRAMPE /
 *   TIEMP APROX DE CARGA / RETIRO VS DESPACHO / TIEMPO DE DESP /
 *   TIEMPO EN PATIO y la regla SVE 'time_anomaly' tampoco funcionaban.
 *
 *   Orden dentro del loop (importa):
 *     1. Resolver PDF / factura / despacho (sin cambios)
 *     2. Cruce WTMS (Status.ID'S MASTER == WTMS.ID de la carga) →
 *        nr['_CARTA_PORTE'] / nr['_ID_RETORNO']
 *     3. Calendario fiscal sobre row['FECHA'] → nr['_DIA'] / nr['_SW']
 *     4. Enrichment de catálogos (Ventana de Recibo / Pool Real) —
 *        requiere los índices ya construidos UNA VEZ por corrida
 *        (buildIndices), no por fila
 *     5. computeTimes(nr) — AL FINAL, requiere que todos los campos de
 *        fecha/hora de nr ya estén resueltos (ver nota de cabecera en
 *        core/time-engine.js)
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
 *   - State (core/state.js) — lee varias propiedades, escribe State.merged,
 *     State.catalogIndices, State.catalogDuplicates
 *   - COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT, MAX_MARCH (core/constants.js)
 *   - FactCache (features/fact-cache.js) — fallback de facturas históricas
 *   - normOp (utils/format.js) — normaliza el nombre de operador para
 *     buscarlo en State.catalog
 *   - buildIndices, enrichRow (features/catalogs/enrichment-engine.js)
 *   - getSW (core/fiscal-calendar.js)
 *   - computeTimes (core/time-engine.js)
 */
import { State } from '../core/state.js';
import { COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT, MAX_MARCH } from '../core/constants.js';
import { FactCache } from '../features/fact-cache.js';
import { normOp } from '../utils/format.js';
import { buildIndices, enrichRow } from '../features/catalogs/enrichment-engine.js';
import { getSW } from '../core/fiscal-calendar.js';
import { computeTimes } from '../core/time-engine.js';

/** Nombres de día en español para la columna DIA — derivados de FECHA. @private */
const DIA_NAMES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

/**
 * Ejecuta el merge completo. No hace nada si falta el Excel o no hay
 * ningún PDF cargado (guard clause idéntica al original).
 * Efecto secundario: reemplaza State.merged con el resultado del cruce,
 * y refresca State.catalogIndices/State.catalogDuplicates (usados por
 * sve.js, regla N).
 */
export function runMerge() {
  if (!State.xlsData || State.pdfData.size === 0) return;
  State.merged = [];

  // Índices de catálogos maestros — UNA VEZ por corrida, no por fila
  // (ver enrichment-engine.js). También detecta llaves duplicadas
  // dentro de un mismo catálogo, reportadas por sve.js (regla N).
  const { indices, duplicates } = buildIndices(State.catalogs);
  State.catalogIndices    = indices;
  State.catalogDuplicates = duplicates;

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

    // ── Cruce con el Reporte WTMS (4ª fuente) ──
    // Status.ID'S MASTER (despRow.idIda) == WTMS.ID de la carga (State.wtmsData key)
    // ver processors/wtms.js, cabecera. "Doble dato" (siguienteCarga con
    // coma) se marca como _wtmsAmbiguous para que el usuario lo resuelva
    // manualmente vía EditSystem (_ID_RETORNO / _CARTA_PORTE editables).
    const wtmsKey = despRow && despRow.idIda ? String(despRow.idIda).trim() : '';
    const wtmsRow = wtmsKey ? (State.wtmsData.get(wtmsKey) || null) : null;
    if (wtmsRow) {
      nr['_CARTA_PORTE'] = wtmsRow.carteporte     || '';
      nr['_ID_RETORNO']  = wtmsRow.siguienteCarga || '';
    } else {
      nr['_CARTA_PORTE'] = ''; nr['_ID_RETORNO'] = '';
    }
    nr['_wtmsAmbiguous'] =
      String(nr['_ID_RETORNO']  || '').includes(',') ||
      String(nr['_CARTA_PORTE'] || '').includes(',');

    // ── Calendario fiscal Walmart (DIA/SW) ──
    // No bloquea el resto del merge si la fecha no tiene FY configurado
    // (ver core/fiscal-calendar.js, "por qué lanza error") — se advierte
    // en consola y la fila queda sin SW/DIA.
    const fechaVal = row['FECHA'];
    nr['_SW'] = ''; nr['_DIA'] = '';
    if (fechaVal) {
      const d = fechaVal instanceof Date ? fechaVal : new Date(fechaVal);
      if (!isNaN(d.getTime())) {
        try {
          nr['_SW']  = getSW(d);
          nr['_DIA'] = DIA_NAMES[d.getDay()];
        } catch (e) {
          console.warn(`[Merge] Ruta ${ruta}: no se pudo calcular SW — ${e.message}`);
        }
      }
    }

    // ── Enrichment de catálogos maestros (Ventana de Recibo / Pool Real) ──
    // No-op seguro si el catálogo correspondiente aún no se ha importado
    // (ver enrichment-engine.js). Los "misses" alimentan las reglas SVE
    // L/M (no_ventana/no_pool).
    nr._enrichMisses = enrichRow(nr, row, indices);

    // ── Motor de tiempos — SIEMPRE al final del loop, requiere que nr
    // ya tenga resueltos todos sus campos de fecha/hora (PDF, despacho,
    // facturación) calculados arriba. ──
    nr._timeAnomalies = computeTimes(nr);

    State.merged.push(nr);
  }
}
