/**
 * features/catalogs/catalog-store.js
 * CATALOG STORE — persistencia de catálogos maestros en Supabase.
 * Mismo patrón que features/catalog.js (operadores): State.catalogs[id]
 * es un array en memoria que sirve de caché de lectura; la tabla de
 * Supabase es la fuente de verdad.
 *
 * DIFERENCIA respecto a operators/fact_cache: los catálogos maestros se
 * REEMPLAZAN por completo cuando hay versión nueva (delete + insert),
 * no se fusionan con upsert — así lo pidió EduarDo explícitamente
 * ("Reemplazarlo cuando exista una versión nueva"). Duplicados dentro
 * de un mismo archivo importado no se filtran aquí — se detectan en
 * enrichment-engine.buildIndices() y se reportan vía SVE, para que el
 * usuario los vea y decida, en vez de que el import los descarte en
 * silencio.
 *
 * Dependencias:
 *   - State (core/state.js) — escribe State.catalogs / State.catalogMeta
 *   - sb (core/supabase-client.js)
 *   - CATALOGS (catalog-registry.js)
 */
import { State } from '../../core/state.js';
import { sb } from '../../core/supabase-client.js';
import { CATALOGS } from './catalog-registry.js';

const META_TABLE = 'catalog_meta';

/** Mapea una fila cruda de Excel (keys arbitrarias) a las columnas canónicas del catálogo, vía regex de alias. @private */
function _mapExcelRow(catalog, excelRow) {
  const keys = Object.keys(excelRow);
  const out  = {};
  for (const [canon, def] of Object.entries(catalog.columns)) {
    const foundKey = keys.find(k => def.aliases.test(k.trim()));
    out[canon] = foundKey ? String(excelRow[foundKey] ?? '').trim() : '';
  }
  return out;
}

export const CatalogStore = {
  /**
   * Carga todos los catálogos registrados + su metadata desde Supabase
   * hacia State.catalogs / State.catalogMeta. Se llama una vez al
   * iniciar la app (ver core/app.js), igual que initCatalog()/FactCache.load().
   * @returns {Promise<void>}
   */
  async loadAll() {
    for (const catalog of Object.values(CATALOGS)) {
      const { data, error } = await sb.from(catalog.table).select('*');
      if (error) {
        console.error(`[CatalogStore] Error cargando ${catalog.label}:`, error.message);
        State.catalogs[catalog.id] = [];
        continue;
      }
      State.catalogs[catalog.id] = data.map(row => {
        const out = {};
        for (const [canon, def] of Object.entries(catalog.columns)) out[canon] = row[def.db] || '';
        return out;
      });
    }

    const { data: metaRows, error: metaError } = await sb.from(META_TABLE).select('*');
    if (metaError) {
      console.warn('[CatalogStore] Error cargando metadata de catálogos:', metaError.message);
      return;
    }
    State.catalogMeta = {};
    (metaRows || []).forEach(m => { State.catalogMeta[m.catalog_id] = m; });
  },

  /**
   * Reemplaza por completo el contenido de un catálogo — borra todo lo
   * anterior e inserta las filas nuevas del Excel importado.
   * @param {string} catalogId — clave en CATALOGS (ej. 'ventanaRecibo')
   * @param {Array<object>} excelRows — filas crudas de XLSX.utils.sheet_to_json
   * @param {string} user — State.user, para metadata de auditoría
   * @returns {Promise<{ok:boolean, count:number}>}
   * @throws {Error} si el archivo no trae columnas reconocibles o falla Supabase
   */
  async replaceCatalog(catalogId, excelRows, user) {
    const catalog = CATALOGS[catalogId];
    if (!catalog) throw new Error('Catálogo desconocido: ' + catalogId);

    const mapped = excelRows
      .map(r => _mapExcelRow(catalog, r))
      .filter(r => catalog.indices.some(idx => r[idx]));
    if (!mapped.length) {
      throw new Error(`El archivo no contiene filas reconocibles para ${catalog.label} (revisa encabezados: ${Object.keys(catalog.columns).join(', ')})`);
    }

    const dbRows = mapped.map(r => {
      const row = {};
      for (const [canon, def] of Object.entries(catalog.columns)) row[def.db] = r[canon] || '';
      return row;
    });

    // Reemplazo completo — ver nota de cabecera. El filtro .neq() con un
    // uuid centinela que nunca existirá en la tabla es el mismo idiom ya
    // usado en fact-cache.js (FactCache.clear()) para "delete all" sin PK simple.
    const { error: delError } = await sb.from(catalog.table)
      .delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delError) throw new Error('No se pudo limpiar el catálogo anterior: ' + delError.message);

    const CHUNK = 500;
    for (let i = 0; i < dbRows.length; i += CHUNK) {
      const { error } = await sb.from(catalog.table).insert(dbRows.slice(i, i + CHUNK));
      if (error) throw new Error('Error insertando catálogo: ' + error.message);
    }

    const meta = {
      catalog_id: catalog.id, label: catalog.label,
      row_count: mapped.length, updated_at: new Date().toISOString(), updated_by: user || null
    };
    const { error: metaError } = await sb.from(META_TABLE).upsert(meta, { onConflict: 'catalog_id' });
    if (metaError) console.warn('[CatalogStore] No se pudo actualizar metadata:', metaError.message);

    State.catalogs[catalogId]     = mapped;
    State.catalogMeta[catalogId]  = meta;
    return { ok: true, count: mapped.length };
  }
};
