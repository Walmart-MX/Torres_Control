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
  merged:   [],          // Final merged rows (output of tryMerge)
  catalog:  new Map(),   // normalizedName → licencia

  // Session
  user: localStorage.getItem('sd_user') || '',
  theme: localStorage.getItem('sd_theme') || 'light',

  // SVE
  sveHasCritical: false,
  sveHasWarnings: false,
  sveLastQuality: 100,
  sveAuditLog: [],

  // Inline edits — patches applied to merged rows this session
  // Each entry: { rowIndex, field, oldVal, newVal, ts }
  edits: [],

  // Fact cache — persistent multi-day concentrado storage
  // Loaded from localStorage on init, written on each XLS load
  factCache: new Map(), // invoice# → { gls, horaFact, date, source }

  // cacheUpdating: true mientras FactCache.persist() está en curso — usado
  // por el panel "Historial de caché" para mostrar el indicador 🔄.
  // Hoy es casi instantáneo (localStorage es síncrono); queda listo para
  // cuando fact_cache migre a Supabase en Camino B Fase 2 (escritura async).
  cacheUpdating: false,

  // Computed helpers
  get matchCount()  { return this.merged.filter(r => r._matched).length; },
  get licCount()    { return this.merged.filter(r => r._LIC).length; },
  get despCount()   { return this.merged.filter(r => r._despMatched).length; },
  get factCount()   { return this.merged.filter(r => r._factMatched).length; },
};
