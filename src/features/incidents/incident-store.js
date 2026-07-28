/**
 * features/incidents/incident-store.js
 * INCIDENT STORE — persistencia del Centro de Mantenimiento en Supabase
 * (tabla admin_incidents). Mismo patrón que catalog-store.js/
 * fact-cache.js: upsert por llave lógica, fire-and-forget desde el
 * caller, nunca bloquea el merge.
 *
 * ARQUITECTURA GENERALIZADA: este módulo no es específico de
 * catálogos — type/sourceId/keyName/keyValue son genéricos (ver
 * incident-types.js). Hoy el único productor es enrichRow() (misses de
 * Ventana de Recibo/Pool Real), pero cualquier módulo futuro puede
 * llamar a IncidentStore.sync() con su propio `type` sin tocar este
 * archivo.
 *
 * AUTO-RESOLUCIÓN: sync(type, sourceIds, raw) recibe TODAS las fuentes
 * relevantes de la corrida — si una fuente no generó NINGÚN miss esta
 * vez, sus incidencias abiertas se resuelven todas (el catálogo ya las
 * cubre). Si generó algunos pero no otros, solo se resuelven los que
 * dejaron de aparecer — nunca se asume nada sobre fuentes que ni
 * siquiera se pasaron en sourceIds.
 *
 * AFFECTED ROUTES: mapa { ruta: last_seen_iso }, podado a MAX_ROUTES
 * entradas (las más antiguas primero) para no crecer sin límite en
 * incidencias muy persistentes. route_count se guarda aparte y NUNCA
 * decrece por la poda — así computePriority() conserva precisión
 * aunque el mapa visual se recorte.
 *
 * Dependencias:
 *   - sb (core/supabase-client.js)
 *   - groupRawIncidents, computePriority (incident-engine.js)
 */
import { sb } from '../../core/supabase-client.js';
import { groupRawIncidents, computePriority } from './incident-engine.js';

const TABLE = 'admin_incidents';
const MAX_ROUTES = 50;

export const IncidentStore = {
  /**
   * Sincroniza las incidencias crudas de UNA corrida contra Supabase.
   * @param {string} type — clave de INCIDENT_TYPES (ej. 'catalog_miss')
   * @param {string[]} sourceIds — todas las fuentes relevantes de este sync
   * @param {Array<{sourceId:string, keyName:string, keyValue:string, ruta:string}>} raw
   * @returns {Promise<void>}
   */
  async sync(type, sourceIds, raw) {
    const groups = groupRawIncidents(raw.map(r => ({ ...r, type })));

    const { data: openRows, error: openErr } = await sb.from(TABLE)
      .select('*').eq('type', type).eq('status', 'open').in('source_id', sourceIds);
    if (openErr) { console.warn('[IncidentStore] Error leyendo incidencias abiertas:', openErr.message); return; }

    const openByKey = new Map(openRows.map(r => [`${r.type}||${r.source_id}||${r.key_name}||${r.key_value}`, r]));
    const nowIso = new Date().toISOString();

    const upserts = [];
    for (const [key, g] of groups) {
      const existing  = openByKey.get(key);
      const routesMap = existing ? { ...(existing.affected_routes || {}) } : {};
      g.routes.forEach(r => { routesMap[r] = nowIso; });

      const entries = Object.entries(routesMap).sort((a, b) => a[1].localeCompare(b[1]));
      while (entries.length > MAX_ROUTES) entries.shift();
      const prunedMap = Object.fromEntries(entries);

      const routeCount = existing
        ? new Set([...Object.keys(existing.affected_routes || {}), ...g.routes]).size
        : g.routes.size;

      upserts.push({
        id: existing?.id,
        type, source_id: g.sourceId, key_name: g.keyName, key_value: g.keyValue,
        status: 'open',
        occurrence_count: (existing?.occurrence_count || 0) + g.count,
        first_seen_at: existing?.first_seen_at || nowIso,
        last_seen_at: nowIso,
        affected_routes: prunedMap,
        route_count: routeCount
      });
      openByKey.delete(key);
    }

    if (upserts.length) {
      const { error } = await sb.from(TABLE).upsert(upserts, { onConflict: 'type,source_id,key_name,key_value' });
      if (error) console.warn('[IncidentStore] Error guardando incidencias:', error.message);
    }

    // Lo que sigue en openByKey ya no apareció en esta corrida → se
    // resuelve automáticamente (el catálogo ya lo cubre).
    const autoResolveIds = [...openByKey.values()].map(r => r.id);
    if (autoResolveIds.length) {
      const { error } = await sb.from(TABLE)
        .update({ status: 'resolved', resolved_at: nowIso, resolved_by: 'sistema (auto)' })
        .in('id', autoResolveIds);
      if (error) console.warn('[IncidentStore] Error auto-resolviendo incidencias:', error.message);
    }
  },

  /**
   * Lista incidencias abiertas ordenadas por prioridad (descendente).
   * @param {string} [type]
   * @returns {Promise<Array<object>>}
   */
  async listOpen(type) {
    let q = sb.from(TABLE).select('*').eq('status', 'open');
    if (type) q = q.eq('type', type);
    const { data, error } = await q;
    if (error) { console.warn('[IncidentStore] Error listando incidencias:', error.message); return []; }
    return data
      .map(r => ({ ...r, priority: computePriority(r) }))
      .sort((a, b) => b.priority - a.priority);
  },

  /** Marca una incidencia como resuelta manualmente. */
  async resolveManually(id, user, note) {
    const { error } = await sb.from(TABLE)
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: user || null, resolution_note: note || null })
      .eq('id', id);
    if (error) throw new Error('No se pudo resolver la incidencia: ' + error.message);
  }
};
