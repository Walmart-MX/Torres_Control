/**
 * core/state.js
 * Estado global de SmartDispatch — única fuente de verdad.
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   Se agrega wtmsData — catálogo TEMPORAL de la corrida actual, NO se
 *   persiste en Supabase. Se reinicia junto con pdfData/xlsData/despData
 *   en UI.resetAll().
 */
export const State = {
  pdfData:  new Map(),
  xlsData:  null,
  factData: new Map(),
  despData: new Map(),
  wtmsData: new Map(),   // idCarga (ID'S MASTER) → { carteporte, siguienteCarga }
  merged:   [],
  catalog:  new Map(),
  catalogs:     { ventanaRecibo: [], poolReal: [] },
  catalogMeta:  {},
  catalogIndices: null,
  catalogDuplicates: [],

  user: localStorage.getItem('sd_user') || '',
  theme: localStorage.getItem('sd_theme') || 'light',

  sveHasCritical: false,
  sveHasWarnings: false,
  sveLastQuality: 100,
  sveAuditLog: [],

  edits: [],

  factCache: new Map(),
  factCacheLog: [],
  cacheUpdating: false,
  todaySession: null,

  get matchCount()  { return this.merged.filter(r => r._matched).length; },
  get licCount()    { return this.merged.filter(r => r._LIC).length; },
  get despCount()   { return this.merged.filter(r => r._despMatched).length; },
  get factCount()   { return this.merged.filter(r => r._factMatched).length; },

  get operationalMode() {
    if (this.todaySession && !this.merged.length) return 'cerrado';
    if (!this.xlsData && this.pdfData.size === 0 && this.despData.size === 0 && this.wtmsData.size === 0) return 'arranque';
    if (!this.merged.length) return 'triage';
    if (this.sveHasCritical || this.sveHasWarnings) return 'correccion';
    return 'listo';
  },
};
