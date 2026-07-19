/**
 * core/state.js
 * Estado global de SmartDispatch — única fuente de verdad.
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   Se agrega wtmsData — catálogo TEMPORAL de la corrida actual
 *   (Map idCarga → {carteporte, siguienteCarga}), poblado por
 *   Events.handleWTMS() vía processors/wtms.js. A diferencia de
 *   operators/fact_cache/catalogs (Camino B/C), NO se persiste en
 *   Supabase ni se carga al iniciar la app — se recarga en cada
 *   procesamiento, como pidió EduarDo explícitamente. Se reinicia
 *   junto con pdfData/xlsData/despData en UI.resetAll().
 *
 *   operationalMode → el check de 'arranque' ahora también considera
 *   despData.size y wtmsData.size (antes solo xlsData/pdfData). Es un
 *   ajuste necesario, no cosmético: con las 4 fuentes obligatorias, si
 *   el usuario carga primero el Status o el WTMS (en vez de PDF/Excel),
 *   la app debía seguir mostrando 'arranque' incorrectamente aunque ya
 *   hubiera algo cargado — ahora cualquier fuente cargada mueve el modo
 *   a 'triage' (esperando las demás), consistente con el resto de la
 *   lógica de fuentes obligatorias (ver Events.checkSources()).
 */
export const State = {
  // Data stores
  pdfData:  new Map(),   // "ruta|factura" | "ruta|D|destino" → pdfRow
  xlsData:  null,        // Array of rows from RUTEO NUEVO
  factData: new Map(),   // invoice# → { gls, horaFact }
  despData: new Map(),   // RUTA → { hrDesp, caseta, wtms, idIda }
  wtmsData: new Map(),   // idCarga (ID'S MASTER) → { carteporte, siguienteCarga } — catálogo temporal, no persiste
  merged:   [],
  catalog:  new Map(),
  catalogs:     { ventanaRecibo: [], poolReal: [] },
  catalogMeta:  {},
  catalogIndices: null,
  catalogDuplicates: [],

  // Session
  user: localStorage.getItem('sd_user') || '',
  theme: localStorage.getItem('sd_theme') || 'light',

  // SVE
  sveHasCritical: false,
  sveHasWarnings: false,
  sveLastQuality: 100,
  sveAuditLog: [],

  edits: [],

  factCache: new Map(),
  factCacheLog: [],
  cacheUpdating: false,
  todaySession: null,

  // Computed helpers
  get matchCount()  { return this.merged.filter(r => r._matched).length; },
  get licCount()    { return this.merged.filter(r => r._LIC).length; },
  get despCount()   { return this.merged.filter(r => r._despMatched).length; },
  get factCount()   { return this.merged.filter(r => r._factMatched).length; },

  /**
   * operationalMode — Fase 5 del rediseño "Centro de Operaciones".
   *   'cerrado'    — ya se exportó una sesión hoy y no hay datos en memoria
   *   'arranque'   — nada cargado todavía (ninguna de las 4 fuentes)
   *   'triage'     — hay al menos una fuente cargada pero el merge
   *                  todavía no produjo resultados — incluye el caso
   *                  de fuentes obligatorias incompletas, porque en
   *                  ese caso runMerge() nunca se ejecuta.
   *   'correccion' — hay resultados y quedan críticos o advertencias
   *   'listo'      — hay resultados y cero críticos/advertencias
   */
  get operationalMode() {
    if (this.todaySession && !this.merged.length) return 'cerrado';
    if (!this.xlsData && this.pdfData.size === 0 && this.despData.size === 0 && this.wtmsData.size === 0) return 'arranque';
    if (!this.merged.length) return 'triage';
    if (this.sveHasCritical || this.sveHasWarnings) return 'correccion';
    return 'listo';
  },
};
