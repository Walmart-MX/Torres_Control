/**
 * features/fact-cache.js
 * FACT CACHE — persistent multi-day concentrado.
 *
 * CAMBIO Camino B / Fase 2: migrado de localStorage a Supabase
 * (tablas `fact_cache` y `fact_cache_log`) — compartido entre todos
 * los usuarios/equipos, igual que el catálogo de operadores en Fase 1.
 *
 * Estrategia (sin cambios respecto a Camino A):
 * - En cada carga de Excel, los nuevos datos de factura se fusionan
 *   (upsert) con el caché existente.
 * - Clave: número de factura (invoice). TTL: 7 días — entradas más
 *   viejas se descartan al cargar (filtro en el SELECT, no borrado
 *   físico — ver comentario en el SQL de la Fase 2).
 * - Marcador visual: las filas que usan datos de caché llevan
 *   _factSource = 'cache' (ver merge.js) — SIN CAMBIOS ahí.
 *
 * INTERFAZ PÚBLICA — qué cambió y qué no:
 *   load(), persist(), clear(), clearLog(), loadLog() → pasan a ser
 *     async (ahora hacen red). Los únicos callers son core/app.js
 *     (bootstrap, ya es async) y events.js (handleXLS, ya es async).
 *   lookup(), stats(), dateSummary(), entriesForDate(), getLog() →
 *     SIGUEN SÍNCRONOS. Operan sobre State.factCache / State.factCacheLog
 *     ya cargados en memoria — exactamente el mismo contrato que tenían
 *     con localStorage. merge.js y ui.js no se modifican por esta fase.
 *
 * DECISIÓN DE RENDIMIENTO: persist() se llama en events.js sin esperar
 * su resultado antes de correr el merge (fire-and-forget + .finally()
 * para refrescar el panel de diagnóstico). runMerge() usa State.factData
 * (el Excel recién leído) como fuente primaria — el caché remoto solo
 * importa como fallback de OTROS días, que ya está cargado en memoria
 * desde el arranque de la app. Por eso el merge no necesita esperar a
 * que termine de escribirse en Supabase.
 *
 * Dependencias:
 *   - State (core/state.js) — lee/escribe State.factCache y State.factCacheLog
 *   - sb (core/supabase-client.js) — cliente Supabase compartido
 */
import { State } from '../core/state.js';
import { sb } from '../core/supabase-client.js';

const TABLE     = 'fact_cache';
const LOG_TABLE = 'fact_cache_log';

export const FactCache = {
  TTL_DAYS:        7,
  MAX_LOG_ENTRIES: 30,

  /**
   * Carga el caché vigente desde Supabase (descarta lo más viejo que TTL_DAYS).
   * @returns {Promise<Map<string, object>>}
   */
  async load() {
    const cutoff = new Date(Date.now() - FactCache.TTL_DAYS * 86400 * 1000).toISOString();
    const { data, error } = await sb.from(TABLE)
      .select('invoice, gls, hora_fact, cache_date, saved_at, source')
      .gte('saved_at', cutoff);

    if (error) {
      console.warn('[FactCache] Error cargando caché desde Supabase:', error.message);
      return new Map();
    }

    const map = new Map();
    for (const row of data) {
      map.set(row.invoice, {
        gls:      row.gls || '',
        horaFact: row.hora_fact || '',
        date:     row.cache_date,
        savedAt:  new Date(row.saved_at).getTime(),
        source:   row.source || 'current'
      });
    }
    return map;
  },

  /**
   * Carga el log de operaciones (más reciente primero) desde Supabase.
   * @returns {Promise<Array<object>>}
   */
  async loadLog() {
    const { data, error } = await sb.from(LOG_TABLE)
      .select('ts, cache_date, count, status, error, user_name')
      .order('ts', { ascending: false })
      .limit(FactCache.MAX_LOG_ENTRIES);

    if (error) {
      console.warn('[FactCache] Error cargando log desde Supabase:', error.message);
      return [];
    }

    return data.map(r => ({
      ts: new Date(r.ts).getTime(), date: r.cache_date,
      count: r.count, status: r.status, error: r.error, user: r.user_name
    }));
  },

  /**
   * Fusiona (upsert) nuevos datos de factura con el caché remoto y
   * actualiza State.factCache de forma optimista (sin round-trip extra
   * de lectura). Registra el resultado en fact_cache_log.
   * @param {Map<string, object>} newFactData
   * @returns {Promise<void>}
   */
  async persist(newFactData) {
    const today      = new Date().toISOString().slice(0, 10);
    const savedAt    = Date.now();
    const savedAtIso = new Date(savedAt).toISOString();

    const rows = [];
    newFactData.forEach((val, inv) => {
      rows.push({
        invoice: inv, gls: val.gls || '', hora_fact: val.horaFact || '',
        cache_date: today, saved_at: savedAtIso, source: 'current'
      });
    });

    if (!rows.length) {
      await FactCache._logResult({ date: today, count: 0, status: 'ok' });
      return;
    }

    const { error } = await sb.from(TABLE).upsert(rows, { onConflict: 'invoice' });

    if (error) {
      console.warn('[FactCache] Could not persist:', error.message);
      await FactCache._logResult({ date: today, count: newFactData.size, status: 'error', error: error.message });
      return;
    }

    newFactData.forEach((val, inv) => {
      State.factCache.set(inv, { gls: val.gls || '', horaFact: val.horaFact || '', date: today, savedAt, source: 'current' });
    });
    console.log('[FactCache] Persisted', newFactData.size, 'entries to Supabase.');
    await FactCache._logResult({ date: today, count: newFactData.size, status: 'ok' });
  },

  /**
   * Busca una factura en el caché ya cargado en memoria (State.factCache).
   * SÍNCRONO — sin cambios respecto a Camino A. Usado como fallback en merge.js.
   * @param {string} inv
   * @returns {object|null}
   */
  lookup(inv) {
    return State.factCache.get(inv) || null;
  },

  /** Limpia el caché de datos por completo (Supabase + memoria). No toca el log. */
  async clear() {
    // fact_cache.invoice nunca es cadena vacía en la práctica — .neq('invoice','')
    // matchea todas las filas reales, es el idiom estándar para "delete all"
    // cuando la PK no es un uuid (a diferencia de fact_cache_log, ver clearLog).
    const { error } = await sb.from(TABLE).delete().neq('invoice', '');
    if (error) { console.warn('[FactCache] Error limpiando caché:', error.message); return; }
    State.factCache = new Map();
  },

  /** Limpia el log de operaciones (Supabase + memoria). */
  async clearLog() {
    const { error } = await sb.from(LOG_TABLE).delete().gte('ts', '1900-01-01');
    if (error) { console.warn('[FactCache] Error limpiando log:', error.message); return; }
    State.factCacheLog = [];
  },

  /**
   * Estadísticas del caché actual — SÍNCRONO, lee State.factCache.
   * @returns {{ total: number, days: number, dates: string[] }}
   */
  stats() {
    const cache = State.factCache;
    const days  = new Set([...cache.values()].map(v => v.date));
    return { total: cache.size, days: days.size, dates: [...days].sort().reverse() };
  },

  /**
   * Inserta una fila en fact_cache_log y actualiza State.factCacheLog
   * de forma optimista. Privado — llamado desde persist().
   * @private
   */
  async _logResult({ date, count, status, error }) {
    const row = {
      ts: new Date().toISOString(), cache_date: date, count, status,
      error: error || null, user_name: State.user || null
    };
    const { error: insertError } = await sb.from(LOG_TABLE).insert(row);
    if (insertError) {
      console.warn('[FactCache] No se pudo escribir el log:', insertError.message);
      return;
    }
    State.factCacheLog.unshift({ ts: Date.now(), date, count, status, error, user: State.user });
    if (State.factCacheLog.length > FactCache.MAX_LOG_ENTRIES) State.factCacheLog.length = FactCache.MAX_LOG_ENTRIES;
  },

  /**
   * Devuelve el log de operaciones ya cargado en memoria, más reciente primero.
   * SÍNCRONO — sin cambios de contrato respecto a Camino A (antes leía
   * localStorage directamente; ahora lee State.factCacheLog, poblado por
   * loadLog() al iniciar y actualizado de forma optimista por persist()).
   * @returns {Array<object>}
   */
  getLog() {
    return State.factCacheLog;
  },

  /**
   * Resumen por fecha del caché actual — SÍNCRONO, sin cambios de lógica
   * respecto a Camino A. Fuente de datos de UI.renderCacheHistory().
   * @returns {Array<{ date:string, count:number, firstSavedAt:number,
   *                    lastSavedAt:number, status:'ok'|'warn'|'err' }>}
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
      return { ...g, firstSavedAt: g.firstSavedAt === Infinity ? 0 : g.firstSavedAt, status };
    });

    return result.sort((a, b) => b.date.localeCompare(a.date));
  },

  /**
   * Lista el detalle de facturas guardadas para una fecha. SÍNCRONO,
   * sin cambios respecto a Camino A.
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
