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
  // Loaded from Supabase on init (Camino B Fase 2), written on each XLS load
  factCache: new Map(), // invoice# → { gls, horaFact, date, savedAt, source }

  // Log de operaciones de FactCache.persist() — usado por el panel
  // "Historial de caché" para mostrar estado ✅/⚠️/❌ por fecha.
  // Cargado desde fact_cache_log (Supabase) al iniciar, actualizado de
  // forma optimista por FactCache._logResult() en cada persist().
  factCacheLog: [],

  // cacheUpdating: true mientras FactCache.persist() está en curso — usado
  // por el panel "Historial de caché" para mostrar el indicador 🔄.
  // Hoy es casi instantáneo (localStorage es síncrono); queda listo para
  // cuando fact_cache migre a Supabase en Camino B Fase 2 (escritura async).
  cacheUpdating: false,

  // Sesión completada del día operativo de hoy (Camino B Fase 3),
  // sincronizada por Events.refreshTodayBanner() y por el bootstrap de
  // core/app.js — antes solo se pasaba directo a UI.renderTodayBanner()
  // sin guardarse en State. Se agrega aquí (Fase 5 del rediseño) porque
  // operationalMode necesita leerla de forma síncrona para calcular el
  // modo 'cerrado' sin depender de una llamada async adicional.
  todaySession: null,

  // Computed helpers
  get matchCount()  { return this.merged.filter(r => r._matched).length; },
  get licCount()    { return this.merged.filter(r => r._LIC).length; },
  get despCount()   { return this.merged.filter(r => r._despMatched).length; },
  get factCount()   { return this.merged.filter(r => r._factMatched).length; },

  /**
   * operationalMode — Fase 5 del rediseño "Centro de Operaciones".
   * Getter puro, sin efectos secundarios: infiere en qué momento del
   * día operativo está el usuario a partir de datos que YA existen en
   * State — no depende de ninguna selección manual.
   *
   *   'cerrado'    — ya se exportó una sesión hoy y no hay datos
   *                  cargados en memoria (recién se abrió la app, o se
   *                  reinició, después de haber cerrado el día)
   *   'arranque'   — nada cargado todavía (ni Excel ni PDFs)
   *   'triage'     — hay al menos una fuente cargada pero el merge
   *                  todavía no produjo resultados (State.merged vacío)
   *   'correccion' — hay resultados y quedan críticos o advertencias
   *   'listo'      — hay resultados y cero críticos/advertencias
   *
   * El orden de los checks importa: 'cerrado' se evalúa primero porque
   * es más informativo que 'arranque' cuando ambas condiciones podrían
   * describir la pantalla (nada cargado, pero el día ya se cerró).
   */
  get operationalMode() {
    if (this.todaySession && !this.merged.length) return 'cerrado';
    if (!this.xlsData && this.pdfData.size === 0) return 'arranque';
    if (!this.merged.length) return 'triage';
    if (this.sveHasCritical || this.sveHasWarnings) return 'correccion';
    return 'listo';
  },
};
