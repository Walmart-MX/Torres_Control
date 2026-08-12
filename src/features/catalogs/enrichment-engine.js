/**
 * features/catalogs/enrichment-engine.js
 * ENRICHMENT ENGINE — motor genérico que aplica ENRICHMENT_RULES.
 *
 * Dos funciones, cero lógica específica de catálogo:
 *   buildIndices(catalogsData) — construye TODOS los índices (Map) UNA
 *     VEZ por corrida de runMerge(), no por fila. También detecta
 *     llaves duplicadas dentro de un mismo catálogo (ej. dos filas de
 *     Pool Real con el mismo ECO) — primero gana, el resto se reporta.
 *   enrichRow(nr, rawRow, indices) — recorre ENRICHMENT_RULES para UNA
 *     fila y llena los campos destino. Si el catálogo correspondiente
 *     está vacío (nunca importado), la regla se salta silenciosamente
 *     — NO se reporta como "no encontrado". Solo se reporta "no
 *     encontrado" cuando el catálogo SÍ tiene datos pero la llave no
 *     matcheó — la ausencia total de catálogo es un estado válido
 *     (todavía no se ha migrado a Camino C) y no debe inundar el SVE.
 *
 * Dependencias:
 *   - CATALOGS (catalog-registry.js)
 *   - ENRICHMENT_RULES (enrichment-rules.js)
 */
import { CATALOGS } from './catalog-registry.js';
import { ENRICHMENT_RULES } from './enrichment-rules.js';

/**
 * @param {object} catalogsData — State.catalogs, { catalogId: Array<row> }
 * @returns {{ indices: Map<string, Map<string, Map<string, object>>>,
 *             duplicates: Array<{catalog:string, index:string, value:string}> }}
 */
export function buildIndices(catalogsData) {
  const indices    = new Map();
  const duplicates = [];

  for (const catalog of Object.values(CATALOGS)) {
    const rows    = catalogsData[catalog.id] || [];
    const byIndex = new Map();

    for (const indexName of catalog.indices) {
      const map = new Map();
      rows.forEach(row => {
        const key = String(row[indexName] || '').trim();
        if (!key) return;
        if (map.has(key)) {
          duplicates.push({ catalog: catalog.id, index: indexName, value: key });
        } else {
          map.set(key, row);
        }
      });
      byIndex.set(indexName, map);
    }
    indices.set(catalog.id, byIndex);
  }
  return { indices, duplicates };
}

/**
 * @param {object} nr       — fila final en construcción (mutada in-place)
 * @param {object} rawRow   — fila cruda de RUTEO NUEVO (State.xlsData[i])
 * @param {Map} indices     — salida de buildIndices().indices
 * @returns {Array<{catalog:string, index:string, sourceCol:string, val:string}>}
 *          — llaves que SÍ tenían valor pero no matchearon en un catálogo
 *          CON datos cargados (para SVE)
 */
export function enrichRow(nr, rawRow, indices) {
  const misses = [];
  for (const rule of ENRICHMENT_RULES) {
    const idx = indices.get(rule.catalog)?.get(rule.index);
    if (!idx || idx.size === 0) continue; // catálogo no cargado — no-op

    const val = String(rawRow[rule.sourceCol] || '').trim();
    if (!val) continue;

    const match = idx.get(val);
    if (match) {
      for (const [destCol, srcCol] of Object.entries(rule.mapping)) {
        nr[destCol] = match[srcCol] || '';
      }
    } else {
      misses.push({ catalog: rule.catalog, index: rule.index, sourceCol: rule.sourceCol, val });
    }
  }
  return misses;
}
