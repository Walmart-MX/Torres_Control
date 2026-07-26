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
 * Nota para integración futura con Supabase (Fase 3 del roadmap de
 * modularización): esta es la pieza que migrará de localStorage a una
 * tabla compartida. La interfaz pública (load/persist/lookup/clear/stats)
 * está diseñada para no cambiar cuando eso ocurra — solo cambia la
 * implementación interna.
 */
import { State } from '../core/state.js';

export const FactCache = {
  STORAGE_KEY: 'sd_fact_cache',
  TTL_DAYS:    7,

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
   * @param {Map<string, object>} newFactData
   */
  persist(newFactData) {
    try {
      const cache   = FactCache.load();
      const today   = new Date().toISOString().slice(0, 10);
      const savedAt = Date.now();
      newFactData.forEach((val, inv) => {
        cache.set(inv, { ...val, date: today, savedAt, source: 'current' });
      });
      const obj = {};
      cache.forEach((v, k) => { obj[k] = v; });
      localStorage.setItem(FactCache.STORAGE_KEY, JSON.stringify(obj));
      State.factCache = cache;
      console.log('[FactCache] Persisted', newFactData.size, 'entries. Total cache:', cache.size);
    } catch (e) {
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

  /** Limpia el caché por completo (localStorage + memoria). */
  clear() {
    localStorage.removeItem(FactCache.STORAGE_KEY);
    State.factCache = new Map();
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
  }
};
