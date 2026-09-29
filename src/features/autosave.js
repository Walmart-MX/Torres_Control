/**
 * features/autosave.js
 * AUTOSAVE - red de seguridad local contra perdida de trabajo antes de
 * exportar. Ver diagnostico: State (core/state.js) vive SOLO en memoria
 * hasta Events.finalizeAndExport() - un refresh accidental, un cierre de
 * pestana o un crash del navegador a mitad de "Correcciones" (despues de
 * capturar incidencias a mano) perdia TODO, sin forma de recuperarlo.
 *
 * DISENO - que se guarda y cuando:
 *   Snapshot completo de las fuentes crudas + el resultado del cruce +
 *   las ediciones manuales, suficiente para reconstruir la sesion tal
 *   cual estaba - NO se vuelve a correr runMerge() al restaurar (eso
 *   perderia las ediciones manuales, que ya estan "horneadas" dentro de
 *   State.merged y no se guardan como parches para reaplicar). Mismo
 *   criterio que ya usa Events.reopenSession() para sesiones del
 *   Historial - ver events.js.
 *
 *   Se llama a save() (debounced) desde los dos unicos lugares donde
 *   State.merged cambia de forma significativa:
 *     - Events.triggerMerge() (events.js) - cualquier fuente nueva o
 *       catalogo maestro editado.
 *     - EditSystem._revalidateAfterEdit() (editing/edit-system.js) -
 *       cualquier correccion manual guardada.
 *   Se llama a clear() cuando el snapshot deja de tener sentido:
 *     - export exitoso (Events.finalizeAndExport()) - el trabajo ya
 *       quedo persistido en Supabase, el respaldo local sobra.
 *     - UI.resetAll() - el usuario pidio explicitamente empezar de cero.
 *
 * DISENO - por que localStorage y no IndexedDB/Supabase:
 *   El volumen de datos de UN dia operativo (cientos de filas, no miles)
 *   cabe holgado en el limite tipico de localStorage (5-10MB). Guardar
 *   en Supabase requeriria conectividad (el punto es sobrevivir incluso
 *   sin red) y una tabla/limpieza adicional para algo que es, por
 *   definicion, descartable en cuanto se exporta. save()/load() nunca
 *   lanzan - un fallo de cuota o de localStorage deshabilitado degrada
 *   a "sin red de seguridad", nunca rompe el flujo normal de captura.
 *
 * Este modulo es puro (no toca el DOM) - la orquestacion (mostrar el
 * aviso de recuperacion, decidir cuando llamar save()) vive en
 * core/app.js y events/events.js, mismo patron que fact-cache.js.
 *
 * Dependencias: ninguna (recibe/devuelve datos planos; el caller decide
 * como mapearlos hacia/desde State).
 */

const KEY = 'sd_autosave';
const DEBOUNCE_MS = 900;
// Un snapshot mas viejo que esto ya no es del dia operativo actual -
// se descarta en silencio en vez de ofrecer "recuperar" datos de hace
// dias, que casi seguro ya no aplican.
const MAX_AGE_MS = 20 * 60 * 60 * 1000; // 20h

let _timer = null;

function _mapToEntries(map) { return [...map.entries()]; }
function _setToArray(set)   { return [...set]; }

function _readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const Autosave = {
  /**
   * Construye el snapshot plano (JSON-serializable) a partir de State.
   * @param {object} State
   */
  _serialize(State) {
    return {
      savedAt:   Date.now(),
      savedBy:   State.user || null,
      pdfData:      _mapToEntries(State.pdfData),
      xlsData:      State.xlsData,
      factData:     _mapToEntries(State.factData),
      despData:     _mapToEntries(State.despData),
      wtmsData:     _mapToEntries(State.wtmsData),
      excludedDettes: _setToArray(State.excludedDettes),
      excludedCount:  State.excludedCount,
      merged:         State.merged,
      edits:          State.edits,
      sveIssues:       State.sveIssues,
      sveHasCritical:  State.sveHasCritical,
      sveHasWarnings:  State.sveHasWarnings,
      sveLastQuality:  State.sveLastQuality,
      sveAuditLog:     State.sveAuditLog,
      captureStartedAt: State.captureStartedAt
    };
  },

  /**
   * Guarda el snapshot actual, con debounce - varias llamadas seguidas
   * (ej. cada tecla de una correccion rapida dispara _revalidateAfterEdit)
   * colapsan en UNA sola escritura a localStorage.
   * @param {object} State
   */
  save(State) {
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(() => {
      _timer = null;
      // Nada que respaldar todavia (ej. las 4 fuentes ni se han
      // terminado de cargar) - no vale la pena escribir un snapshot vacio.
      if (!State.merged.length) return;
      try {
        localStorage.setItem(KEY, JSON.stringify(Autosave._serialize(State)));
      } catch (e) {
        // Cuota excedida o localStorage deshabilitado - se degrada a
        // "sin red de seguridad" sin interrumpir la captura en curso.
        console.warn('[Autosave] No se pudo guardar el snapshot local:', e.message);
      }
    }, DEBOUNCE_MS);
  },

  /**
   * Vista ligera del snapshot (para el aviso de recuperacion) sin
   * reconstruir Maps/Sets todavia. null si no hay snapshot, o si el
   * que hay ya expiro (ver MAX_AGE_MS) - en ese caso lo limpia de una vez.
   * @returns {{savedAt:number, savedBy:string|null, rowCount:number, editCount:number}|null}
   */
  peek() {
    const data = _readRaw();
    if (!data) return null;
    if (Date.now() - data.savedAt > MAX_AGE_MS) { Autosave.clear(); return null; }
    return {
      savedAt:   data.savedAt,
      savedBy:   data.savedBy,
      rowCount:  data.merged ? data.merged.length : 0,
      editCount: data.edits  ? data.edits.length  : 0
    };
  },

  /**
   * Reconstruye Maps/Sets y vuelca el snapshot completo sobre State.
   * Deliberadamente NO corre runMerge() - ver nota de cabecera. El
   * caller (Events.restoreAutosave()) se encarga de re-pintar la UI.
   * @param {object} State
   * @returns {boolean} false si no habia snapshot valido
   */
  restoreInto(State) {
    const data = _readRaw();
    if (!data) return false;
    State.pdfData          = new Map(data.pdfData || []);
    State.xlsData           = data.xlsData || null;
    State.factData          = new Map(data.factData || []);
    State.despData          = new Map(data.despData || []);
    State.wtmsData          = new Map(data.wtmsData || []);
    State.excludedDettes    = new Set(data.excludedDettes || []);
    State.excludedCount     = data.excludedCount || 0;
    State.merged            = data.merged || [];
    State.edits             = data.edits || [];
    State.sveIssues         = data.sveIssues || [];
    State.sveHasCritical    = !!data.sveHasCritical;
    State.sveHasWarnings    = !!data.sveHasWarnings;
    State.sveLastQuality    = data.sveLastQuality ?? 100;
    State.sveAuditLog       = data.sveAuditLog || [];
    State.captureStartedAt  = data.captureStartedAt || null;
    return true;
  },

  clear() {
    try { localStorage.removeItem(KEY); } catch { /* no-op */ }
  }
};
