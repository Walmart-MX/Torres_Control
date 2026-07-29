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
 * Estrategia de match PDF (en orden de prioridad):
 *   1. ruta + factura del Excel (match específico)
 *   2. ruta + DETTE.1 del Excel (match específico)
 *   3. ruta + DETTE del Excel (match específico)
 *   4. único PDF con la misma ruta, SOLO si no hay ambigüedad (ver FIX
 *      de integridad de datos, jul-2026, abajo)
 *
 * FIX DE INTEGRIDAD DE DATOS (jul-2026) — "bug del marchamo heredado":
 *   Se detectó un caso real: una ruta con dos entregas, la segunda con
 *   un bloque de PDF ilegible/malformado (marchamo con formato inválido
 *   → parsePDF() nunca genera una entrada específica para esa entrega).
 *   El fallback anterior ("cualquier PDF con la misma ruta") tomaba la
 *   PRIMERA coincidencia del Map — que resultaba ser la entrega
 *   correcta de la OTRA entrega ya cargada. Consecuencia: la última
 *   entrega heredaba marchamo Y factura de la primera — una
 *   correspondencia inventada, no real.
 *
 *   Principio aplicado: es preferible dejar una entrega sin datos y
 *   reportar una incidencia crítica, que asignarle información de otra
 *   entrega. El fallback por ruta ahora:
 *     - Cuenta cuántos bloques de PDF distintos existen para esa ruta
 *       (dedupe por referencia de objeto — State.pdfData indexa el
 *       mismo objeto bajo dos claves: factura y destino).
 *     - Si hay EXACTAMENTE un candidato → se usa (caso legítimo y
 *       frecuente: ruta de una sola entrega, sin ambigüedad posible).
 *     - Si hay MÁS DE UNO y ninguno matcheó específicamente → NO se
 *       adivina. pdfRow queda null, la entrega se marca
 *       nr['_pdfAmbiguous'] = true, y features/validation/sve.js
 *       reporta la incidencia CRÍTICA 'pdf_ambiguous' en vez de
 *       inventar una correspondencia.
 *
 *   Complementa el fix en events.js → handlePDFs(), que ahora evita
 *   indexar claves vacías en State.pdfData (factura/destino '') — esa
 *   colisión de claves vacías era la otra vía por la que un match
 *   "específico" podía terminar apuntando al bloque equivocado.
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
 *     1. Resolver PDF (con el fix de ambigüedad) / factura / despacho
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
 * Estrategia de match de factura:
 *   1. State.factData (concentrado del Excel recién cargado)
 *   2. FactCache.lookup() como fallback (concentrado de días anteriores)
 *
 * CAMBIO (Centro de Mantenimiento — Fase 2, jul-2026):
 *   Los "misses" de enrichRow() (r._enrichMisses) ya no se descartan al
 *   final de cada corrida — se acumulan en catalogMissesRaw y, tras el
 *   loop, se sincronizan con el Centro de Mantenimiento vía
 *   IncidentStore.sync() (fire-and-forget, mismo patrón que
 *   FactCache.persist() — nunca bloquea el merge).
 *
 *   activeCatalogIds — SOLO se incluyen catálogos que tienen datos
 *   cargados en State.catalogs en este momento. Esto es deliberado (ver
 *   incident-store.js, nota de cabecera "AUTO-RESOLUCIÓN SEGURA"): si
 *   un catálogo se vació por error, su sourceId queda fuera de la
 *   sincronización y sus incidencias abiertas NO se auto-resuelven por
 *   error — solo se auto-resuelven incidencias de catálogos que
 *   realmente se evaluaron esta corrida.
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
 *   - IncidentStore (features/incidents/incident-store.js) — sync del
 *     Centro de Mantenimiento
 *   - INCIDENT_TYPES (features/incidents/incident-types.js)
 */
import { State } from '../core/state.js';
import { COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT, MAX_MARCH } from '../core/constants.js';
import { FactCache } from '../features/fact-cache.js';
import { normOp } from '../utils/format.js';
import { buildIndices, enrichRow } from '../features/catalogs/enrichment-engine.js';
import { getSW } from '../core/fiscal-calendar.js';
import { computeTimes } from '../core/time-engine.js';
import { IncidentStore } from '../features/incidents/incident-store.js';
import { INCIDENT_TYPES } from '../features/incidents/incident-types.js';

/** Nombres de día en español para la columna DIA — derivados de FECHA. @private */
const DIA_NAMES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

/**
 * Ejecuta el merge completo. No hace nada si falta el Excel o no hay
 * ningún PDF cargado (guard clause idéntica al original).
 * Efecto secundario: reemplaza State.merged con el resultado del cruce,
 * refresca State.catalogIndices/State.catalogDuplicates (usados por
 * sve.js, regla N), y sincroniza el Centro de Mantenimiento con los
 * misses de catálogo de esta corrida (ver nota de cabecera).
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

  // Acumulador de misses de catálogo de ESTA corrida — alimenta el
  // sync con el Centro de Mantenimiento al final del loop (ver nota de
  // cabecera "CAMBIO (Centro de Mantenimiento — Fase 2)").
  const catalogMissesRaw = [];

  for (const row of State.xlsData) {
    const ruta    = String(row[COL_RUTA]    || '').trim();
    const detteF  = String(row[COL_DETTE_F] || '').trim();
    const factXls = String(row[COL_FACT]    || '').trim();

    let pdfRow = null, pdfMatchType = 'none', pdfAmbiguous = false;
    if (factXls) { const r = State.pdfData.get(ruta + '|' + factXls); if (r) { pdfRow = r; pdfMatchType = 'specific'; } }
    if (!pdfRow && detteF) { const r = State.pdfData.get(ruta + '|D|' + detteF); if (r) { pdfRow = r; pdfMatchType = 'specific'; } }
    if (!pdfRow) {
      const detteE = String(row[COL_DETTE_E] || '').trim();
      if (detteE) { const r = State.pdfData.get(ruta + '|D|' + detteE); if (r) { pdfRow = r; pdfMatchType = 'specific'; } }
    }
    // Fallback seguro — ver nota de cabecera "FIX DE INTEGRIDAD DE DATOS".
    // Solo se activa cuando NO hay ambigüedad posible.
    if (!pdfRow && ruta) {
      const seen = new Set(), candidates = [];
      for (const [, v] of State.pdfData) {
        if (v.ruta === ruta && !seen.has(v)) { seen.add(v); candidates.push(v); }
      }
      if (candidates.length === 1) {
        pdfRow = candidates[0];
        pdfMatchType = 'fallback';
      } else if (candidates.length > 1) {
        // Múltiples bloques de PDF candidatos para esta ruta y ninguno
        // matcheó específicamente por factura/DETTE — no hay forma de
        // saber cuál corresponde a esta entrega. NUNCA se adivina.
        pdfAmbiguous = true;
      }
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

    // Marca de integridad — leída por features/validation/sve.js (regla
    // 'pdf_ambiguous') y disponible para diagnóstico/exportación futura.
    // false en el caso normal (match específico, fallback seguro, o
    // simplemente sin PDF de ningún tipo para esta ruta). Cubre el caso
    // "no se encontró NINGÚN bloque de PDF con certeza" — distinto del
    // caso "sí se encontró el bloque, pero un campo puntual (marchamo)
    // no validó", que se maneja campo por campo vía _marchamoIssues,
    // ver bloque if(pdfRow){...} más abajo.
    nr['_pdfAmbiguous'] = pdfAmbiguous;

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
      // Marchamos candidatos que pdf.js detectó pero no pudo validar —
      // ver processors/pdf.js (extracción tolerante por campo, jul-2026).
      // La posición correspondiente en MARCHAMO N ya quedó vacía arriba;
      // esto solo aporta el valor crudo para diagnóstico en el SVE
      // (regla 'bad_march') — nunca afecta OPERADOR/TARIMAS/FAC_PDF,
      // que se extrajeron de forma independiente.
      nr['_marchamoIssues'] = pdfRow.marchamoIssues || [];
    } else {
      nr['OPERADOR'] = '';
      nr['TARIMAS']  = '';
      for (let m = 0; m < MAX_MARCH; m++) nr['MARCHAMO ' + (m + 1)] = '';
      nr['_CITA_PDF'] = ''; nr['CITA'] = ''; nr['_LIC'] = ''; nr['_HR_DESP_PDF'] = '';
      nr['_marchamoIssues'] = [];
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
    // L/M (no_ventana/no_pool) Y, desde jul-2026, el Centro de
    // Mantenimiento (ver catalogMissesRaw más abajo).
    nr._enrichMisses = enrichRow(nr, row, indices);
    nr._enrichMisses.forEach(m => {
      catalogMissesRaw.push({ sourceId: m.catalog, keyName: m.index, keyValue: m.val, ruta });
    });

    // ── Motor de tiempos — SIEMPRE al final del loop, requiere que nr
    // ya tenga resueltos todos sus campos de fecha/hora (PDF, despacho,
    // facturación) calculados arriba. ──
    nr._timeAnomalies = computeTimes(nr);

    State.merged.push(nr);
  }

  // ── Sync con el Centro de Mantenimiento (Fase 2, jul-2026) ──
  // Fire-and-forget — nunca bloquea el merge ni la UI (mismo patrón que
  // FactCache.persist() en events.js). activeCatalogIds SOLO incluye
  // catálogos con datos cargados ahora mismo — ver nota de cabecera
  // "AUTO-RESOLUCIÓN SEGURA" en incident-store.js: si un catálogo está
  // vacío, sus incidencias abiertas quedan intactas en vez de
  // auto-resolverse por error.
  const activeCatalogIds = Object.keys(State.catalogs).filter(id => (State.catalogs[id] || []).length > 0);
  IncidentStore.sync(INCIDENT_TYPES.catalog_miss.id, activeCatalogIds, catalogMissesRaw)
    .catch(e => console.warn('[Merge] No se pudo sincronizar el Centro de Mantenimiento:', e.message));
}
