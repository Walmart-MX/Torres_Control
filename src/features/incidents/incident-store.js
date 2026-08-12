/**
 * features/incidents/incident-store.js
 * INCIDENT STORE — persistencia del Centro de Mantenimiento en Supabase
 * (tabla admin_incidents). Mismo patrón que catalog-store.js/
 * fact-cache.js: upsert por llave lógica, fire-and-forget desde el
 * caller (ver processors/merge.js), nunca bloquea el merge.
 *
 * ARQUITECTURA GENERALIZADA: este módulo no es específico de
 * catálogos — type/sourceId/keyName/keyValue son genéricos (ver
 * incident-types.js). Hoy el único productor es enrichRow() (misses de
 * Ventana de Recibo/Pool Real, vía processors/merge.js), pero cualquier
 * módulo futuro puede llamar a IncidentStore.sync() con su propio
 * `type` sin tocar este archivo.
 *
 * CAMBIO DE DISEÑO respecto al boceto inicial (jul-2026) — semántica de
 * occurrence_count: runMerge() se ejecuta muchas veces por sesión de
 * captura (cada fuente cargada, cada edición de catálogo dispara
 * Events.triggerMerge() de nuevo) — NO una vez al día. Si cada llamada
 * a sync() sumara +1 por aparición, el contador se inflaría solo por
 * reprocesar, rompiendo la premisa de la fórmula de prioridad
 * (incident-engine.js): "frecuencia alta = señal confiable de un gap
 * real". Se corrige contando pares distintos (ruta, día) — reprocesar
 * la misma ruta el mismo día varias veces ya NO suma occurrence_count;
 * una ruta nueva o un día nuevo sí. Se implementa comparando la fecha
 * (slice a 10 caracteres, YYYY-MM-DD) ya guardada en affected_routes
 * para esa ruta contra la fecha de hoy.
 *
 * AUTO-RESOLUCIÓN SEGURA: sync(type, sourceIds, raw) recibe SOLO los
 * sourceIds de catálogos que el caller confirma que tienen datos
 * cargados en este momento (ver processors/merge.js, filtro
 * activeCatalogIds). Si un catálogo se vació por error, su sourceId
 * queda fuera de sourceIds y sus incidencias abiertas NO se tocan —
 * evita el riesgo ya documentado en el diseño de Fase 1 ("auto-
 * resolución incorrecta si el catálogo se vacía por error"). Dentro de
 * los sourceIds recibidos, cualquier incidencia abierta que ya no
 * aparezca en `raw` de esta corrida se marca resuelta automáticamente
 * — el catálogo ya la cubre.
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
   * @param {string[]} sourceIds — SOLO las fuentes que el caller confirma
   *   evaluadas en esta corrida (ej. catálogos con datos cargados) —
   *   determina qué incidencias son elegibles para auto-resolución.
   * @param {Array<{sourceId:string, keyName:string, keyValue:string, ruta:string}>} raw
   * @returns {Promise<void>}
   */
  async sync(type, sourceIds, raw) {
    if (!sourceIds || !sourceIds.length) return; // nada evaluado — no-op seguro

    const groups = groupRawIncidents(raw.map(r => ({ ...r, type })));

    const { data: openRows, error: openErr } = await sb.from(TABLE)
      .select('*').eq('type', type).eq('status', 'open').in('source_id', sourceIds);
    if (openErr) { console.warn('[IncidentStore] Error leyendo incidencias abiertas:', openErr.message); return; }

    const openByKey = new Map(openRows.map(r => [`${r.type}||${r.source_id}||${r.key_name}||${r.key_value}`, r]));
    const nowIso = new Date().toISOString();
    const today  = nowIso.slice(0, 10);

    const upserts = [];
    for (const [key, g] of groups) {
      const existing  = openByKey.get(key);
      const routesMap = existing ? { ...(existing.affected_routes || {}) } : {};

      // Solo cuentan como occurrence_count nuevo los pares (ruta, día)
      // que NO estaban ya registrados hoy — ver nota de cabecera
      // "CAMBIO DE DISEÑO". Reprocesar la misma ruta el mismo día no
      // infla el contador; una ruta nueva o un día nuevo sí.
      let newOccurrences = 0;
      g.routes.forEach(ruta => {
        const prevDate = routesMap[ruta] ? String(routesMap[ruta]).slice(0, 10) : null;
        if (prevDate !== today) newOccurrences++;
        routesMap[ruta] = nowIso;
      });

      // Poda del mapa visual — las entradas más antiguas primero.
      // route_count NUNCA decrece por esto (se calcula sobre la unión
      // completa, antes de podar).
      const routeCount = new Set([
        ...Object.keys(existing?.affected_routes || {}),
        ...g.routes
      ]).size;

      const entries = Object.entries(routesMap).sort((a, b) => a[1].localeCompare(b[1]));
      while (entries.length > MAX_ROUTES) entries.shift();
      const prunedMap = Object.fromEntries(entries);

// FIX (ago-2026 — 400 Bad Request en el upsert): antes se incluía
      // `id: existing?.id` aquí. Para incidencias NUEVAS, existing es
      // undefined, así que el objeto declaraba la key 'id' con valor
      // undefined — supabase-js arma la lista de columnas del INSERT a
      // partir de las keys DECLARADAS de todos los objetos del batch
      // (id cuenta aunque su valor sea undefined), pero al serializar a
      // JSON esa key se descarta. PostgREST terminaba recibiendo una
      // petición que anunciaba la columna 'id' sin valor real para las
      // filas nuevas → viola la restricción NOT NULL de la PK → 400.
      // No hace falta enviar 'id' en absoluto: onConflict ya localiza
      // la fila correcta para actualizar (llave lógica real es
      // type+source_id+key_name+key_value, no id), y para inserts el
      // default de la tabla (gen_random_uuid()) genera el id solo.
      upserts.push({
        type, source_id: g.sourceId, key_name: g.keyName, key_value: g.keyValue,
        status: 'open',
        occurrence_count: (existing?.occurrence_count || 0) + newOccurrences,
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

    // Lo que sigue en openByKey pertenece a un sourceId evaluado en
    // esta corrida y ya no apareció → se resuelve automáticamente (el
    // catálogo ya lo cubre).
    const autoResolveIds = [...openByKey.values()].map(r => r.id);
    if (autoResolveIds.length) {
      const { error } = await sb.from(TABLE)
        .update({ status: 'resolved', resolved_at: nowIso, resolved_by: 'sistema (auto)' })
        .in('id', autoResolveIds);
      if (error) console.warn('[IncidentStore] Error auto-resolviendo incidencias:', error.message);
    }
  },

  /**
   * Lista incidencias abiertas, con prioridad recalculada al vuelo,
   * ordenadas de mayor a menor prioridad.
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

  /**
   * Lista incidencias resueltas (más recientes primero) — histórico
   * para el panel colapsable del Centro de Mantenimiento.
   * @param {string} [type]
   * @param {number} [limit=50]
   * @returns {Promise<Array<object>>}
   */
  async listResolved(type, limit = 50) {
    let q = sb.from(TABLE).select('*').eq('status', 'resolved')
      .order('resolved_at', { ascending: false }).limit(limit);
    if (type) q = q.eq('type', type);
    const { data, error } = await q;
    if (error) { console.warn('[IncidentStore] Error listando resueltas:', error.message); return []; }
    return data;
  },

  /** Marca una incidencia como resuelta manualmente. */
  async resolveManually(id, user, note) {
    const { error } = await sb.from(TABLE)
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: user || null, resolution_note: note || null })
      .eq('id', id);
    if (error) throw new Error('No se pudo resolver la incidencia: ' + error.message);
  }
};
