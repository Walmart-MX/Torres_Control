/**
 * core/state.js
 * Estado global de SmartDispatch — única fuente de verdad.
 *
 * Este objeto es mutado directamente por varios módulos (processors,
 * Events, EditSystem). Es intencional: la arquitectura actual no usa
 * un patrón estricto de inmutabilidad. Documentar quién escribe cada
 * propiedad es responsabilidad de quien la modifica.
 *
 * No tiene dependencias de otros módulos propios — solo lee localStorage,
 * que está disponible globalmente en el navegador.
 */
export const State = {
  // Data stores
  pdfData:  new Map(),   // "ruta|factura" | "ruta|D|destino" → pdfRow
  xlsData:  null,        // Array of rows from RUTEO NUEVO
  factData: new Map(),   // invoice# → { gls, horaFact }
  despData: new Map(),   // RUTA → { hrDesp, caseta, wtms, idIda }
  wtmsData: new Map(),   // ID de la carga → { carteporte, siguienteCarga }
  merged:   [],          // Final merged rows (output of tryMerge)
  catalog:  new Map(),   // normalizedName → licencia
  // Catálogos maestros (Camino C) — reemplazan RUTEO NUEVO manual de
  // FORMATO/TIENDA/ESTADO (Ventana de Recibo) y LINEA/PLACAS/CAPACIDAD
  // (Pool Real). Empiezan vacíos hasta que se importen desde el panel
  // "Catálogos" — el motor de enriquecimiento no-opea con seguridad
  // mientras tanto.
  catalogs:     { ventanaRecibo: [], poolReal: [] },
  catalogMeta:  {},   // catalogId → { row_count, updated_at, updated_by }
  catalogIndices: null,   // Map — reconstruido en cada runMerge()
  catalogDuplicates: [],  // llaves duplicadas detectadas — leído por sve.js

  // Entregas del PDF que no encontraron contraparte por Ruta+Destino
  // (ni por Ruta+Factura) durante el último runMerge() — ver
  // processors/merge.js, algoritmo de match jul-2026. Cada entrada:
  // { ruta, destino, factura }. Alimenta la regla SVE 'pdf_orphan'
  // (features/validation/sve.js). Se recalcula por completo en cada
  // corrida de runMerge() — no se persiste ni se guarda en el
  // historial de Supabase (dispatch-history.js), es puramente un
  // diagnóstico de la corrida actual en memoria.
  pdfOrphans: [],

  // Entregas confirmadas por el usuario como "no se van a realizar" (ej.
  // se quedaron por ocupación y ya no tienen bloque en el PDF) — ver
  // features/validation/sve.js regla 'dette_sin_pdf' y
  // events.js → confirmExcludedDette(). Clave: "ruta||dette" (mismo
  // campo DETTE que usa sve.js vía getMapped(r,'DET')). Se excluyen POR
  // COMPLETO en processors/merge.js — nunca llegan a State.merged, así
  // que jamás se pintan, generan incidencia, exportan, ni se guardan en
  // el historial de Supabase: el archivo final y el historial quedan
  // automáticamente fieles a la decisión del usuario, sin tocar
  // export.js ni dispatch-history.js. Se reinicia en UI.resetAll().
  //
  // LIMITACIÓN CONOCIDA (confirmada con EduarDo, jul-2026): vive SOLO
  // en memoria de la sesión — si se recarga la página a medio día
  // operativo, la exclusión se pierde y la entrega reaparece en el
  // próximo merge (habría que volver a confirmarla). Es irreversible
  // una vez exportado: la entrega desaparece del Excel y del historial
  // de Supabase sin dejar rastro de auditoría — si en el futuro se
  // necesita trazabilidad de "qué se excluyó y por qué", requeriría una
  // tabla de auditoría aparte (fuera del alcance de este cambio).
  excludedDettes: new Set(),

  // Contador de entregas excluidas (State.excludedDettes) que efectivamente
  // se filtraron en LA CORRIDA MÁS RECIENTE de runMerge() — NUEVO (jul-2026,
  // ver sve.js regla 'integrity'/K). Se recalcula desde cero en cada
  // runMerge(); nunca se lee excludedDettes.size directamente para esto
  // porque ese Set puede acumular claves de días operativos anteriores que
  // ya no aplican al Excel cargado ahora — solo cuenta lo que se excluyó
  // AHORA, para poder explicar honestamente una discrepancia entre el
  // conteo del Excel y State.merged sin generar una falsa alarma crítica.
  excludedCount: 0,

  // Session
  user: localStorage.getItem('sd_user') || '',
  theme: localStorage.getItem('sd_theme') || 'light',

  // SVE
  sveHasCritical: false,
  sveHasWarnings: false,
  sveLastQuality: 100,
  sveAuditLog: [],
  // Último array de incidencias devuelto por runSVE() — NUEVO (rediseño
  // Mesa de Trabajo, jul-2026). Antes runSVE() era consumido una sola
  // vez por Events.triggerMerge()/EditSystem.saveAndRevalidate() para
  // pintar el panel SVE y se descartaba. Ahora también lo necesita
  // UI._buildRowStatusMap() para derivar el status pill (Completa /
  // Advertencia / Crítica / Corregida) de cada fila de la tabla —
  // cruza issue.rowIds contra cada row._rowId. Se escribe en los mismos
  // dos puntos donde antes solo se llamaba a UI.renderSVE(); null/[]
  // cuando no hay filas (mismo caso en que runSVE() devuelve null).
  sveIssues: [],

  // Inline edits — patches applied to merged rows this session
  // Each entry: { rowIndex, field, oldVal, newVal, ts }
  edits: [],

  // Fact cache — persistent multi-day concentrado storage
  // Loaded from Supabase on init (Camino B Fase 2), written on each XLS load
  factCache: new Map(), // invoice# → { gls, horaFact, date, savedAt, source }

  // Log de operaciones de FactCache.persist() — usado por el panel
  // "Historial de caché" para mostrar estado ✅/⚠️/❌ por fecha.
  // Cargado desde fact_cache_log (Supabase) al iniciar, actualizado de
  // forma optimista por FactCache._logResult() en cada persist().
  factCacheLog: [],

  // cacheUpdating: true mientras FactCache.persist() está en curso — usado
  // por el panel "Historial de caché" para mostrar el indicador 🔄.
  cacheUpdating: false,

  // Sesión completada del día operativo de hoy (Camino B Fase 3),
  // sincronizada por Events.refreshTodayBanner() y por el bootstrap de
  // core/app.js.
  todaySession: null,

  // Marca de tiempo del primer merge exitoso de la sesión (las 4
  // fuentes completas por primera vez) — NUEVO (Calidad, mockup
  // jul-2026). Alimenta el metric "Tiempo de captura" del Dashboard de
  // Calidad. Se fija UNA sola vez por sesión (Events.triggerMerge no
  // la reescribe en merges subsecuentes causados por re-importar un
  // catálogo) y se limpia en UI.resetAll().
  captureStartedAt: null,

  // Computed helpers
  get matchCount()  { return this.merged.filter(r => r._matched).length; },
  get licCount()    { return this.merged.filter(r => r._LIC).length; },
  get despCount()   { return this.merged.filter(r => r._despMatched).length; },
  get factCount()   { return this.merged.filter(r => r._factMatched).length; },

  /**
   * operationalMode — getter puro, sin efectos secundarios: infiere en
   * qué momento del día operativo está el usuario a partir de datos que
   * YA existen en State — no depende de ninguna selección manual.
   *
   *   'cerrado'    — ya se exportó una sesión hoy y no hay datos
   *                  cargados en memoria (recién se abrió la app, o se
   *                  reinició, después de haber cerrado el día)
   *   'arranque'   — nada cargado todavía (ni Excel ni PDFs)
   *   'triage'     — hay al menos una fuente cargada pero el merge
   *                  todavía no produjo resultados (State.merged vacío)
   *   'correccion' — hay resultados y quedan críticos o advertencias
   *   'listo'      — hay resultados y cero críticos/advertencias
   */
  get operationalMode() {
    if (this.todaySession && !this.merged.length) return 'cerrado';
    if (!this.xlsData && this.pdfData.size === 0) return 'arranque';
    if (!this.merged.length) return 'triage';
    if (this.sveHasCritical || this.sveHasWarnings) return 'correccion';
    return 'listo';
  },
};
