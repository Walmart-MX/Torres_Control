/**
 * processors/merge.js
 * MERGE ENGINE — cruza los datos de las cuatro fuentes (Excel/RUTEO,
 * PDFs, concentrado de facturas, panel de despacho) y produce
 * State.merged: el array que alimenta la tabla, el SVE y la exportación.
 *
 * A diferencia de pdf.js / excel.js / paste.js, esta función NO es pura:
 * lee State.xlsData, State.pdfData, State.factData, State.despData,
 * State.catalog, State.catalogs, State.wtmsData, State.excludedDettes
 * directamente, y escribe el resultado en State.merged. Es intencional
 * — preserva exactamente el comportamiento original.
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
 *     - Si hay MÁS DE UNO → ver FIX (jul-2026 — distinción ambigüedad
 *       real vs entrega ausente) más abajo.
 *
 *   Complementa el fix en events.js → handlePDFs(), que ahora evita
 *   indexar claves vacías en State.pdfData (factura/destino '') — esa
 *   colisión de claves vacías era la otra vía por la que un match
 *   "específico" podía terminar apuntando al bloque equivocado.
 *
 * FIX (jul-2026 — distinción "ambigüedad real" vs "entrega ausente del
 * PDF"): antes, CUALQUIER caso con más de un bloque de PDF candidato
 * para la ruta (y sin match específico) se reportaba como
 * 'pdf_ambiguous', aunque el DETTE de la fila en cuestión simplemente
 * NO existiera en ningún bloque del PDF — caso real confirmado con
 * EduarDo: una entrega se queda por ocupación y ya no se genera su
 * bloque en el PDF (el PDF lo emite la misma plataforma WTMS, así que
 * si la entrega ya no va, el PDF nunca la trae). Ese caso NO es una
 * ambigüedad — no hay nada que "adivinar entre varios candidatos", la
 * entrega sencillamente no está. Se distingue verificando si el DETTE
 * buscado aparece como `destino` en alguno de los bloques candidatos
 * de esa ruta:
 *   - Si SÍ aparece entre los destinos → ambigüedad real (más de un
 *     bloque podría corresponder, no se puede determinar cuál). Sigue
 *     reportándose como 'pdf_ambiguous' (CRÍTICA, bloquea exportación)
 *     — sin cambios en ese comportamiento.
 *   - Si NO aparece → la entrega no está en el PDF, punto. Se marca
 *     nr['_pdfDetteAusente'] = true y sve.js la reporta aparte (regla
 *     'dette_sin_pdf', ADVERTENCIA) con opción de que el usuario
 *     confirme la exclusión — ver bloque de exclusión más abajo.
 *
 * NUEVO (jul-2026 — exclusión de entregas confirmadas como "no se
 * realizarán"): cuando el usuario confirma desde Correcciones que una
 * entrega marcada 'dette_sin_pdf' efectivamente no se va a realizar
 * (ver events.js → confirmExcludedDette()), su clave "ruta||dette" se
 * agrega a State.excludedDettes. Esta función la filtra AL INICIO del
 * loop, antes de construir cualquier campo — la fila NUNCA llega a
 * State.merged. Esto es deliberado: features/export.js y
 * features/dispatch-history.js leen State.merged directamente y sin
 * ningún filtro adicional, así que excluir aquí garantiza que el
 * Excel final y el historial de Supabase queden automáticamente
 * fieles a la decisión del usuario — sin duplicar la lógica de
 * exclusión en esos dos módulos.
 *
 * CAMBIO (jul-2026 — contador de exclusiones para la regla SVE
 * 'integrity'/K): se agrega State.excludedCount, reiniciado a 0 al
 * inicio de cada runMerge() e incrementado cada vez que el filtro de
 * excludedDettes descarta una fila EN ESTA CORRIDA. No se reutiliza
 * State.excludedDettes.size directamente para esto porque ese Set
 * puede acumular claves de días operativos anteriores que ya no
 * aplican al Excel cargado ahora — excludedCount solo cuenta lo que
 * se excluyó AHORA. Consumido por features/validation/sve.js (regla K)
 * vía el nuevo parámetro de runSVE(rows, screenCount, excludedCount) —
 * ver events.js/edit-system.js. No cambia en absoluto la lógica de
 * QUÉ filas se excluyen ni cómo se exportan — es puramente informativo
 * para que el SVE pueda explicar una discrepancia de conteo legítima
 * (DETTE cancelada y confirmada) sin generar una alerta crítica falsa.
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
 * CAMBIO (Fase 3 de la migración de la Macro Despacho, ago-2026) —
 * REORDENAMIENTO DEL PIPELINE a DOS PASADAS:
 *   Antes, todo el trabajo de una fila (match de PDF/factura/despacho,
 *   cruce WTMS, calendario fiscal, enrichment de catálogos, motor de
 *   tiempos) ocurría en UNA sola pasada, dentro del mismo loop, y cada
 *   `nr` se empujaba a State.merged inmediatamente.
 *
 *   La consolidación automática de HUB (features/hub-consolidation.js)
 *   necesita ver TODAS las filas de una ruta a la vez para poder
 *   agruparlas por destino real — no puede vivir dentro de un loop
 *   fila-por-fila. Y una vez que la consolidación cambia el DETTE de
 *   una fila (de un ID de factura individual al número de HUB real),
 *   el enrichment de catálogos (Ventana de Recibo, que cruza
 *   exactamente por DETTE) debe correr DESPUÉS de esa consolidación,
 *   no antes — si no, buscaría en el catálogo con el DETTE equivocado.
 *
 *   Por eso runMerge() ahora tiene dos pasadas:
 *     PASADA 1 (por fila): filtro de exclusiones, match de PDF/
 *       factura/despacho, cruce WTMS, calendario fiscal — construye
 *       cada `nr` pero NO llama enrichRow()/computeTimes() ni empuja a
 *       State.merged todavía.
 *     ENTRE PASADAS: consolidateHubs() agrupa por (ruta, destino) y
 *       colapsa los grupos de HUB; assignDeterminants() genera
 *       ENT1/2/3.../nU sobre el resultado YA consolidado (ver
 *       features/hub-consolidation.js para el porqué de este orden,
 *       validado con datos reales).
 *     PASADA 2 (por fila, sobre el resultado consolidado): enrichRow()
 *       (ahora con el DETTE final) y computeTimes() — recién aquí se
 *       empuja cada fila a State.merged.
 *
 *   Ningún comportamiento de la PASADA 1 cambia respecto al código
 *   anterior — es exactamente la misma lógica, solo que ya no llama
 *   enrichRow()/computeTimes()/push() al final de cada iteración.
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
 *     State.catalogIndices, State.catalogDuplicates, State.excludedCount
 *   - COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT, MAX_MARCH (core/constants.js)
 *   - FactCache (features/fact-cache.js) — fallback de facturas históricas
 *   - normOp (utils/format.js) — normaliza el nombre de operador para
 *     buscarlo en State.catalog
 *   - buildIndices, enrichRow (features/catalogs/enrichment-engine.js)
 *   - getSW (core/fiscal-calendar.js)
 *   - computeTimes (core/time-engine.js)
 *   - consolidateHubs, assignDeterminants (features/hub-consolidation.js) — NUEVO (Fase 3)
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
import { consolidateHubs, assignDeterminants } from '../features/hub-consolidation.js';
import { IncidentStore } from '../features/incidents/incident-store.js';
import { INCIDENT_TYPES } from '../features/incidents/incident-types.js';

/** Nombres de día en español para la columna DIA — derivados de FECHA. @private */
const DIA_NAMES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

/**
 * Ejecuta el merge completo. No hace nada si falta el Excel o no hay
 * ningún PDF cargado (guard clause idéntica al original).
 * Efecto secundario: reemplaza State.merged con el resultado del cruce,
 * refresca State.catalogIndices/State.catalogDuplicates (usados por
 * sve.js, regla N), State.excludedCount (usado por sve.js, regla K), y
 * sincroniza el Centro de Mantenimiento con los misses de catálogo de
 * esta corrida (ver nota de cabecera).
 */
export function runMerge() {
  if (!State.xlsData || State.pdfData.size === 0) return;
  State.merged = [];
  // Reiniciado en cada corrida — ver nota de cabecera "CAMBIO (jul-2026
  // — contador de exclusiones...)".
  State.excludedCount = 0;

  // Índices de catálogos maestros — UNA VEZ por corrida, no por fila
  // (ver enrichment-engine.js). También detecta llaves duplicadas
  // dentro de un mismo catálogo, reportadas por sve.js (regla N).
  const { indices, duplicates } = buildIndices(State.catalogs);
  State.catalogIndices    = indices;
  State.catalogDuplicates = duplicates;

  // ── PASADA 1 (por fila) — ver nota de cabecera "CAMBIO (Fase 3 —
  // REORDENAMIENTO DEL PIPELINE)". Construye cada `nr` con el match de
  // PDF/factura/despacho, cruce WTMS y calendario fiscal ya resueltos,
  // pero SIN enrichment de catálogos ni motor de tiempos todavía —
  // ambos corren en la PASADA 2, después de consolidar HUB. ──
  const rawRows = [];

  for (const row of State.xlsData) {
    const ruta    = String(row[COL_RUTA]    || '').trim();
    const detteF  = String(row[COL_DETTE_F] || '').trim();
    const detteE  = String(row[COL_DETTE_E] || '').trim();
    const factXls = String(row[COL_FACT]    || '').trim();

    // ── Exclusión de entregas confirmadas como "no se van a realizar" ──
    // Ver core/state.js → excludedDettes. La entrega NUNCA llega a
    // State.merged — garantiza que tabla, SVE, exportación e historial
    // de Supabase queden consistentes sin tocar esos módulos. Se
    // compara contra detteE, el mismo campo que sve.js lee vía
    // getMapped(r,'DET') (DET → row['DETTE'], ver COL_MAP en
    // constants.js) para construir la clave del issue 'dette_sin_pdf'.
    if (State.excludedDettes.has(ruta + '||' + detteE)) {
      // CAMBIO (jul-2026) — ver nota de cabecera "contador de
      // exclusiones". No cambia el comportamiento de filtrado, solo
      // deja constancia de cuántas filas se excluyeron en ESTA corrida
      // para que sve.js (regla K) pueda descontarlas honestamente.
      State.excludedCount++;
      continue;
    }

    let pdfRow = null, pdfMatchType = 'none', pdfAmbiguous = false, pdfDetteAusente = false;
    if (factXls) { const r = State.pdfData.get(ruta + '|' + factXls); if (r) { pdfRow = r; pdfMatchType = 'specific'; } }
    if (!pdfRow && detteF) { const r = State.pdfData.get(ruta + '|D|' + detteF); if (r) { pdfRow = r; pdfMatchType = 'specific'; } }
    if (!pdfRow && detteE) { const r = State.pdfData.get(ruta + '|D|' + detteE); if (r) { pdfRow = r; pdfMatchType = 'specific'; } }
    // Fallback seguro — ver nota de cabecera "FIX DE INTEGRIDAD DE DATOS".
    // Solo se activa cuando NO hay match específico.
    if (!pdfRow && ruta) {
      const seen = new Set(), candidates = [], destinosEnPdf = new Set();
      for (const [, v] of State.pdfData) {
        if (v.ruta === ruta && !seen.has(v)) { seen.add(v); candidates.push(v); destinosEnPdf.add(v.destino); }
      }
      if (candidates.length === 1) {
        pdfRow = candidates[0];
        pdfMatchType = 'fallback';
      } else if (candidates.length > 1) {
        // FIX (jul-2026 — distinción "ambigüedad real" vs "entrega
        // ausente del PDF") — ver nota de cabecera para el detalle
        // completo. Se verifica si el DETTE de ESTA fila aparece como
        // destino en alguno de los bloques candidatos de la ruta.
        const detteBuscado = detteF || detteE;
        if (detteBuscado && destinosEnPdf.has(detteBuscado)) {
          // El DETTE sí está en el PDF, pero en más de un bloque sin
          // match específico — no hay forma de saber cuál corresponde.
          // NUNCA se adivina.
          pdfAmbiguous = true;
        } else {
          // El DETTE de esta fila no aparece en ningún bloque del PDF
          // de la ruta — no es ambigüedad, la entrega simplemente no
          // está. Ver features/validation/sve.js, regla 'dette_sin_pdf'.
          pdfDetteAusente = true;
        }
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
    const _rowId = ruta + '||' + (detteF || String(rawRows.length));
    const nr = { ...row, _rowId, _matched: !!pdfRow, _factMatched: !!factRow, _despMatched: !!despRow };

    // Marca de integridad — leída por features/validation/sve.js (regla
    // 'pdf_ambiguous') y disponible para diagnóstico/exportación futura.
    // false en el caso normal (match específico, fallback seguro, o
    // simplemente sin PDF de ningún tipo para esta ruta). Cubre el caso
    // "existen varios bloques y ninguno corresponde con certeza" —
    // distinto de 'pdfDetteAusente' (ningún bloque corresponde, punto) y
    // distinto de "sí se encontró el bloque, pero un campo puntual
    // (marchamo) no validó", que se maneja campo por campo vía
    // _marchamoIssues, ver bloque if(pdfRow){...} más abajo.
    nr['_pdfAmbiguous']     = pdfAmbiguous;
    // Marca de integridad — leída por sve.js (regla 'dette_sin_pdf').
    // true cuando ningún bloque de PDF de la ruta corresponde a esta
    // entrega (caso real: entrega retirada por ocupación, el PDF —
    // generado por la misma plataforma WTMS — nunca la trae). Ver nota
    // de cabecera "FIX (jul-2026 — distinción...)" para el detalle.
    nr['_pdfDetteAusente'] = pdfDetteAusente;

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

    rawRows.push(nr);
  }

  // ── Consolidación automática de HUB (Fase 3, ago-2026) ──
  // Ver features/hub-consolidation.js para el detalle completo de la
  // regla (validada con datos reales) y del catálogo de exclusión.
  // Corre sobre TODAS las filas de rawRows a la vez (necesita ver el
  // conjunto completo de cada ruta para poder agrupar por destino).
  const excludedDeterminantes = new Set(
    (State.catalogs.hubExclusions || [])
      .map(r => String(r['DETERMINANTE'] || '').trim())
      .filter(Boolean)
  );
  const consolidatedRows = consolidateHubs(rawRows, excludedDeterminantes);

  // ── Determinantes ENT1/2/3.../nU (Fase 3) ──
  // SIEMPRE después de consolidar — ver nota de cabecera de
  // hub-consolidation.js para por qué el orden importa (numerar antes
  // de consolidar produciría una numeración que nunca existió en el
  // proceso real).
  assignDeterminants(consolidatedRows);

  // ── PASADA 2 (por fila, sobre el resultado YA consolidado) —
  // enrichment de catálogos maestros + motor de tiempos. Ver nota de
  // cabecera "CAMBIO (Fase 3 — REORDENAMIENTO DEL PIPELINE)": debe
  // correr aquí, no en la pasada 1, porque el DETTE de las filas
  // consolidadas por HUB solo es el valor FINAL a partir de este punto.
  const catalogMissesRaw = [];

  for (const nr of consolidatedRows) {
    // ── Enrichment de catálogos maestros (Ventana de Recibo / Pool Real) ──
    // No-op seguro si el catálogo correspondiente aún no se ha importado
    // (ver enrichment-engine.js). Los "misses" alimentan las reglas SVE
    // L/M (no_ventana/no_pool) Y, desde jul-2026, el Centro de
    // Mantenimiento (ver catalogMissesRaw más abajo). Se pasa `nr` como
    // ambos argumentos (fila final Y fila "cruda") porque, tras la
    // consolidación de HUB, `nr['DETTE']` ya es el valor FINAL — no el
    // de la fila original de RUTEO NUEVO, que pudo pertenecer a una
    // factura individual ya absorbida por el grupo.
    nr._enrichMisses = enrichRow(nr, nr, indices);
    const ruta = String(nr[COL_RUTA] || '').trim();
    nr._enrichMisses.forEach(m => {
      catalogMissesRaw.push({ sourceId: m.catalog, keyName: m.index, keyValue: m.val, ruta });
    });

    // ── Motor de tiempos — requiere que nr ya tenga resueltos todos
    // sus campos de fecha/hora (PDF, despacho, facturación), calculados
    // en la PASADA 1. ──
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
