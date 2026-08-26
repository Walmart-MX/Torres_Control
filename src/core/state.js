/**
 * core/state.js
 * STATE — única fuente de verdad de la aplicación (ver constitución del
 * proyecto: "UI nunca toma decisiones de negocio; State es la única
 * fuente de verdad; los processors son funciones puras").
 *
 * Todos los módulos leen/escriben directamente sobre este objeto — no
 * hay getters/setters salvo `user` (ver nota abajo). No contiene
 * lógica de negocio ni de persistencia: eso vive en processors/,
 * features/ y events/. Este módulo solo declara la forma y el valor
 * inicial de cada propiedad.
 *
 * RECONSTRUCCIÓN (ago-2026): este archivo se sobrescribió por accidente
 * con el bloque HTML de #authOverlay (que sí pertenece a index.html) —
 * causaba "Uncaught SyntaxError: HTML comments are not allowed in
 * modules" al cargar. Se reconstruyó leyendo el contrato real que cada
 * módulo de src/ espera de State (merge.js, sve.js, ui.js, events.js,
 * edit-system.js, catalog-store.js, fact-cache.js, dispatch-history.js,
 * app.js, auth.js) — todas las propiedades enumeradas abajo están
 * confirmadas contra un uso real en el código, ninguna es inventada.
 *
 * ── Identidad de usuario (Fase 1 de Auth, ver features/auth.js) ──
 *   currentUser — objeto { id, username, displayName, captureName } o
 *     null si no hay sesión. Única fuente de verdad de identidad;
 *     Auth.restoreSession()/Auth.login() lo pueblan.
 *   user — GETTER de solo lectura, alias a currentUser?.displayName.
 *     Es la propiedad que leen directamente merge.js/events.js/
 *     edit-system.js/fact-cache.js/dispatch-history.js/constants.js
 *     (columna CAPTURA) para atribuir ediciones, exportaciones y
 *     registros de caché a "quién lo hizo" — se mantiene como getter
 *     (no como valor copiado) para que SIEMPRE refleje el usuario
 *     activo, incluso si currentUser cambia (login/cambio de perfil)
 *     sin depender de que cada caller reasigne State.user a mano.
 *
 * Sin dependencias de otros módulos propios.
 */
export const State = {
  // ── Tema de interfaz ──
  theme: localStorage.getItem('sd_theme') || 'light',

  // ── Identidad (features/auth.js) ──
  currentUser: null,
  get user() {
    return State.currentUser ? State.currentUser.displayName : null;
  },

  // ── Catálogo de operadores (features/catalog.js — Camino B, Fase 1) ──
  // Map<op_name, lic> — caché local de lectura rápida; Supabase es la
  // fuente de verdad (tabla `operators`).
  catalog: new Map(),

  // ── Catálogos maestros (features/catalogs/ — Camino C) ──
  // catalogs: { ventanaRecibo: [...], poolReal: [...] } — cada array en
  // forma canónica (ver catalog-store.js → _dbRowToCanonical()).
  catalogs: {},
  // catalogMeta: { ventanaRecibo: {...}, poolReal: {...} } — row_count/
  // updated_at/updated_by por catálogo (tabla `catalog_meta`).
  catalogMeta: {},
  // catalogIndices/catalogDuplicates — recalculados en CADA runMerge()
  // por enrichment-engine.buildIndices(); consumidos por sve.js (regla N).
  catalogIndices: new Map(),
  catalogDuplicates: [],

  // ── Fuentes crudas del día operativo (4 obligatorias) ──
  // pdfData: Map<'ruta|factura' | 'ruta|D|destino', rawRow> — ver pdf.js/events.js.
  pdfData: new Map(),
  // xlsData: Array<rawRow> de la hoja RUTEO NUEVO, o null si no se ha cargado.
  xlsData: null,
  // factData: Map<invoice, {gls, horaFact}> — hoja CONCENTRADO FACTURAS del Excel recién leído.
  factData: new Map(),
  // despData: Map<ruta, {hrDesp, caseta, wtms, idIda}> — panel "Status de despacho" (paste.js).
  despData: new Map(),
  // wtmsData: Map<idCarga, {carteporte, siguienteCarga}> — Reporte WTMS (processors/wtms.js). No se persiste.
  wtmsData: new Map(),

  // ── Exclusiones confirmadas ("se quedó por ocupación", ver events.js → confirmExcludedDette()) ──
  // Set<'ruta||dette'> — persiste durante la sesión del navegador (no en Supabase);
  // merge.js la filtra al inicio de cada corrida, antes de construir cualquier campo.
  excludedDettes: new Set(),
  // excludedCount — cuántas filas se excluyeron en la corrida MÁS RECIENTE de runMerge()
  // (no el tamaño acumulado de excludedDettes) — consumido por sve.js, regla K.
  excludedCount: 0,

  // ── Resultado del cruce (processors/merge.js) ──
  // merged: Array<nr> — única fuente que leen ui.js/export.js/dispatch-history.js/sve.js.
  merged: [],

  // ── Smart Validation Engine (features/validation/sve.js) ──
  sveIssues: [],
  sveHasCritical: false,
  sveHasWarnings: false,
  sveLastQuality: 100,
  // sveAuditLog — historial en memoria de acciones de exportación (clean/forced/warned) de esta sesión.
  sveAuditLog: [],

  // ── Ediciones manuales (editing/edit-system.js) ──
  // edits: Array<{rowId, ruta, field, oldVal, newVal, ts, user}> — auditoría +
  // fuente del status pill "Corregida" en Mesa de Trabajo.
  edits: [],

  // ── Fact Cache — concentrado multi-día (features/fact-cache.js — Camino B, Fase 2) ──
  factCache: new Map(),
  factCacheLog: [],
  // cacheUpdating — true mientras FactCache.persist() está en vuelo (fire-and-forget);
  // solo afecta el badge visual en Administración → Caché de facturas.
  cacheUpdating: false,

  // ── Sesión de captura / historial (features/dispatch-history.js — Camino B, Fase 3) ──
  // captureStartedAt — timestamp (Date.now()) de cuándo las 4 fuentes quedaron completas
  // por primera vez en esta sesión; null hasta entonces. Usado para "tiempo de captura" en Calidad.
  captureStartedAt: null,
  // todaySession — sesión completada más reciente del día operativo de hoy, o null.
  todaySession: null,
  // reviewSessionId — NUEVO (ago-2026, "reabrir para corregir"): id de la sesión del
  // Historial que se está revisando, o null en flujo normal. Ver events.js → reopenSession()/checkSources().
  reviewSessionId: null,

  // ── Modo operativo visual (ui.js → applyMode(), document.body.dataset.mode) ──
  operationalMode: 'default'
};
