/**
 * features/fact-cache.js
 * FACT CACHE — persistent multi-day concentrado.
 *
 * Estrategia:
 * - En cada carga de Excel, los nuevos datos de factura se fusionan
 *   con el caché existente en localStorage.
 * - Clave de caché: número de factura. Valor: { gls, horaFact, date, source }.
 * - En el merge: si una factura no está en los datos del Excel actual,
 *   se recurre al caché como fallback.
 * - TTL: 7 días — entradas más viejas se descartan al cargar.
 * - Marcador visual: las filas que usan datos de caché llevan
 *   _factSource = 'cache' (ver merge.js).
 * - Estimado de almacenamiento: ~200 bytes/factura × 500 facturas
 *   = ~100KB/día × 7 días = ~700KB — dentro del límite de 5MB de localStorage.
 *
 * Dependencia: State.factCache (definida en core/state.js). Este módulo
 * lee y escribe esa propiedad directamente — es la única fuente de verdad
 * en memoria para el caché ya cargado.
 *
 * DIAGNÓSTICO — Historial de Caché (agregado sobre Camino A, previo a
 * Camino B Fase 2):
 *   Se agrega un log de operaciones (_appendLog/getLog/clearLog) separado
 *   del caché de datos — registra cada persist() exitoso o fallido, para
 *   que el panel "Historial de caché" (ui.js → renderCacheHistory) pueda
 *   mostrar estado ✅/⚠️/❌ por fecha sin adivinar. dateSummary() y
 *   entriesForDate() son funciones de solo lectura que combinan
 *   State.factCache + el log — no mutan nada, seguras de llamar en
 *   cualquier momento (ej. al abrir el panel).
 *
 * Nota para integración futura con Supabase (Fase 2 del roadmap de
 * Camino B): esta es la pieza que migrará de localStorage a una tabla
 * compartida. La interfaz pública (load/persist/lookup/clear/stats,
 * y ahora dateSummary/entriesForDate/getLog) está diseñada para no
 * cambiar cuando eso ocurra — solo cambia la implementación interna.
 */
import { State } from '../core/state.js';

export const FactCache = {
  STORAGE_KEY:     'sd_fact_cache',
  STORAGE_KEY_LOG: 'sd_fact_cache_log',
  MAX_LOG_ENTRIES: 30,
  TTL_DAYS:        7,

  /**
   * Carga el caché desde localStorage, descartando entradas expiradas.
   * @returns {Map<string, object>}
   */
  load() {
    try {
      const raw  = localStorage.getItem(FactCache.STORAGE_KEY);
      if (!raw) return new Map();
      const obj  = JSON.parse(raw);
      const now  = Date.now();
      const ttl  = FactCache.TTL_DAYS * 86400 * 1000;
      const map  = new Map();
      for (const [inv, entry] of Object.entries(obj)) {
        if (now - (entry.savedAt || 0) < ttl) map.set(inv, entry);
      }
      return map;
    } catch { return new Map(); }
  },

  /**
   * Fusiona nuevos datos de factura (de un Excel recién cargado) con el
   * caché persistente, guarda en localStorage, y actualiza State.factCache.
   * Registra el resultado (éxito/error) en el log de operaciones.
   * @param {Map<string, object>} newFactData
   */
  persist(newFactData) {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const cache   = FactCache.load();
      const savedAt = Date.now();
      newFactData.forEach((val, inv) => {
        cache.set(inv, { ...val, date: today, savedAt, source: 'current' });
      });
      const obj = {};
      cache.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(FactCache.STORAGE_KEY, JSON.stringify(obj));
      State.factCache = cache;
      FactCache._appendLog({ ts: savedAt, date: today, count: newFactData.size, status: 'ok' });
      console.log('[FactCache] Persisted', newFactData.size, 'entries. Total cache:', cache.size);
    } catch (e) {
      FactCache._appendLog({ ts: Date.now(), date: today, count: newFactData.size, status: 'error', error: e.message });
      console.warn('[FactCache] Could not persist:', e.message);
    }
  },

  /**
   * Busca una factura en el caché ya cargado en memoria (State.factCache).
   * Usado como fallback cuando el Excel actual no trae esa factura.
   * @param {string} inv — número de factura
   * @returns {object|null}
   */
  lookup(inv) {
    return State.factCache.get(inv) || null;
  },

  /** Limpia el caché de datos por completo (localStorage + memoria). No toca el log. */
  clear() {
    localStorage.removeItem(FactCache.STORAGE_KEY);
    State.factCache = new Map();
  },

  /** Limpia el log de operaciones (usado junto con clear() desde el panel de diagnóstico). */
  clearLog() {
    localStorage.removeItem(FactCache.STORAGE_KEY_LOG);
  },

  /**
   * Estadísticas del caché actual — usado en el badge de XLS
   * y en mensajes de diagnóstico.
   * @returns {{ total: number, days: number, dates: string[] }}
   */
  stats() {
    const cache = State.factCache;
    const days  = new Set([...cache.values()].map(v => v.date));
    return { total: cache.size, days: days.size, dates: [...days].sort().reverse() };
  },

  // ── Log de operaciones (privado + lectura pública) ──

  /**
   * Registra una operación de persist() en el log, más reciente primero,
   * capado a MAX_LOG_ENTRIES para no crecer indefinidamente en localStorage.
   * @private
   */
  _appendLog(entry) {
    try {
      const raw = localStorage.getItem(FactCache.STORAGE_KEY_LOG);
      const log = raw ? JSON.parse(raw) : [];
      log.unshift(entry);
      if (log.length > FactCache.MAX_LOG_ENTRIES) log.length = FactCache.MAX_LOG_ENTRIES;
      localStorage.setItem(FactCache.STORAGE_KEY_LOG, JSON.stringify(log));
    } catch {
      // El log es solo diagnóstico — si falla (ej. localStorage lleno),
      // no debe interrumpir el flujo real de persist().
    }
  },

  /**
   * Devuelve el log de operaciones de caché, más reciente primero.
   * @returns {Array<{ ts:number, date:string, count:number, status:'ok'|'error', error?:string }>}
   */
  getLog() {
    try {
      const raw = localStorage.getItem(FactCache.STORAGE_KEY_LOG);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  },

  // ── Consultas para el panel "Historial de caché" (solo lectura) ──

  /**
   * Resumen por fecha del caché actual — combina State.factCache (datos)
   * con el log de operaciones (estado del último guardado por fecha).
   * Fuente de datos de UI.renderCacheHistory().
   *
   * status:
   *   'ok'   — hay un registro de guardado exitoso más reciente para esa fecha
   *   'err'  — el último persist() registrado para esa fecha falló
   *   'warn' — hay datos pero no hay registro de guardado (ej. caché de
   *            antes de que este log existiera) — no es un error real,
   *            se resuelve solo con el siguiente persist() o al expirar TTL
   *
   * @returns {Array<{ date:string, count:number, firstSavedAt:number,
   *                    lastSavedAt:number, status:'ok'|'warn'|'err' }>}
   *          ordenado por fecha descendente (más reciente primero)
   */
  dateSummary() {
    const byDate = new Map();
    State.factCache.forEach(entry => {
      const d = entry.date || '—';
      if (!byDate.has(d)) byDate.set(d, { date: d, count: 0, firstSavedAt: Infinity, lastSavedAt: 0 });
      const g = byDate.get(d);
      g.count++;
      if (entry.savedAt) {
        g.firstSavedAt = Math.min(g.firstSavedAt, entry.savedAt);
        g.lastSavedAt  = Math.max(g.lastSavedAt, entry.savedAt);
      }
    });

    const log = FactCache.getLog();
    const result = [...byDate.values()].map(g => {
      const lastLogForDate = log.find(l => l.date === g.date);
      let status = 'warn';
      if (lastLogForDate) status = lastLogForDate.status === 'error' ? 'err' : 'ok';
      return {
        ...g,
        firstSavedAt: g.firstSavedAt === Infinity ? 0 : g.firstSavedAt,
        status
      };
    });

    return result.sort((a, b) => b.date.localeCompare(a.date));
  },

  /**
   * Lista el detalle de facturas guardadas para una fecha específica.
   * Usado por la vista de detalle expandible del Historial de Caché.
   *
   * @param {string} date — YYYY-MM-DD
   * @returns {Array<{ invoice:string, gls:string, horaFact:string, savedAt:number }>}
   */
  entriesForDate(date) {
    const rows = [];
    State.factCache.forEach((entry, inv) => {
      if ((entry.date || '—') === date) {
        rows.push({ invoice: inv, gls: entry.gls || '', horaFact: entry.horaFact || '', savedAt: entry.savedAt || 0 });
      }
    });
    return rows.sort((a, b) => a.invoice.localeCompare(b.invoice));
  }
};
