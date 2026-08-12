/**
 * features/incidents/incident-engine.js
 * INCIDENT ENGINE — funciones puras de agrupación y priorización del
 * Centro de Mantenimiento. No conoce Supabase ni State — solo
 * transforma incidencias crudas de una corrida en grupos, y calcula el
 * score de prioridad de una incidencia ya persistida.
 *
 * FÓRMULA DE PRIORIDAD (confirmada con EduarDo, jul-2026):
 *   freqScore  = min(1, occurrence_count / PRIORITY_CAPS.freq)
 *   routeScore = min(1, route_count / PRIORITY_CAPS.routes)
 *   ageScore   = min(1, díasDesdeFirstSeen / PRIORITY_CAPS.ageDays)
 *   priority   = round(100 × (freq·0.45 + routes·0.30 + age·0.25))
 *
 * Pesos: la frecuencia pesa más porque es la señal más confiable de un
 * gap real (vs. un typo aislado); la amplitud de rutas mide impacto
 * operativo directo; la antigüedad pesa menos porque sola no distingue
 * "sigue activo" de "casi resuelto pero nadie lo cerró".
 *
 * NOTA sobre occurrence_count (ver incident-store.js para el detalle
 * completo): NO cuenta "veces que se corrió el merge" — cuenta pares
 * distintos (ruta, día) en que la llave apareció como faltante. Así,
 * reprocesar la misma ruta varias veces en una sesión de captura no
 * infla artificialmente la prioridad.
 *
 * La prioridad NUNCA se persiste como valor fijo — se recalcula en cada
 * lectura (incident-store.js → listOpen()), porque depende de la
 * antigüedad, que cambia sin ninguna escritura nueva.
 *
 * Sin dependencias de otros módulos propios.
 */

export const PRIORITY_WEIGHTS = { freq: 0.45, routes: 0.30, age: 0.25 };
export const PRIORITY_CAPS    = { freq: 20, routes: 10, ageDays: 14 };

/**
 * Agrupa incidencias crudas de UNA corrida por (type, sourceId, keyName, keyValue).
 * @param {Array<{type:string, sourceId:string, keyName:string, keyValue:string, ruta:string}>} raw
 * @returns {Map<string, {type,sourceId,keyName,keyValue, routes:Set<string>, count:number}>}
 */
export function groupRawIncidents(raw) {
  const groups = new Map();
  for (const item of raw) {
    const key = `${item.type}||${item.sourceId}||${item.keyName}||${item.keyValue}`;
    if (!groups.has(key)) {
      groups.set(key, {
        type: item.type, sourceId: item.sourceId, keyName: item.keyName,
        keyValue: item.keyValue, routes: new Set(), count: 0
      });
    }
    const g = groups.get(key);
    g.count++;
    if (item.ruta) g.routes.add(item.ruta);
  }
  return groups;
}

/**
 * Calcula el score de prioridad 0-100 de una incidencia ya persistida.
 * @param {{ occurrence_count:number, first_seen_at:string, route_count:number }} incident
 * @returns {number} 0-100
 */
export function computePriority(incident) {
  const freqScore  = Math.min(1, (incident.occurrence_count || 0) / PRIORITY_CAPS.freq);
  const routeScore = Math.min(1, (incident.route_count || 0) / PRIORITY_CAPS.routes);
  const ageDays     = incident.first_seen_at
    ? (Date.now() - new Date(incident.first_seen_at).getTime()) / 86400000
    : 0;
  const ageScore = Math.min(1, ageDays / PRIORITY_CAPS.ageDays);

  const raw = PRIORITY_WEIGHTS.freq * freqScore
            + PRIORITY_WEIGHTS.routes * routeScore
            + PRIORITY_WEIGHTS.age * ageScore;
  return Math.round(raw * 100);
}

/** Convierte un score 0-100 a nivel visual para la UI — reutiliza las
 *  mismas clases que .status-pill (ok/warn/crit) ya usa la Mesa de
 *  Trabajo, más 'info' para prioridad baja. */
export function priorityTier(score) {
  if (score >= 66) return { key: 'alta',  label: 'Alta',  cls: 'crit' };
  if (score >= 33) return { key: 'media', label: 'Media', cls: 'warn' };
  return { key: 'baja', label: 'Baja', cls: 'info' };
}
