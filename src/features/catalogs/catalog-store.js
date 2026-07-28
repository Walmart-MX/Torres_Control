/**
 * features/catalogs/catalog-store.js
 * CATALOG STORE — persistencia de catálogos maestros en Supabase.
 * Mismo patrón que features/catalog.js (operadores): State.catalogs[id]
 * es un array en memoria que sirve de caché de lectura; la tabla de
 * Supabase es la fuente de verdad.
 *
 * DIFERENCIA respecto a operators/fact_cache: los catálogos maestros se
 * REEMPLAZAN por completo cuando hay versión nueva vía importación de
 * Excel (delete + insert), no se fusionan con upsert — así lo pidió
 * EduarDo explícitamente ("Reemplazarlo cuando exista una versión
 * nueva"). Duplicados dentro de un mismo archivo importado no se
 * filtran aquí — se detectan en enrichment-engine.buildIndices() y se
 * reportan vía SVE, para que el usuario los vea y decida, en vez de
 * que el import los descarte en silencio.
 *
 * CAMBIO (jul-2026 — administración de catálogos fila por fila):
 *   Se agregan addRow()/deleteRow() — edición individual de registros
 *   desde el panel Administración (mismo espíritu que catalog.js
 *   addOperator()/deleteOperator() para el catálogo de operadores, pero
 *   SIN upsert por clave única: un catálogo maestro puede tener varias
 *   filas con el mismo índice sin que sea un error de captura — la
 *   detección de duplicados vive aparte en enrichment-engine.js/SVE).
 *
 *   Para soportar borrado individual, cada fila en State.catalogs[id]
 *   ahora conserva su `_id` (uuid primario de Supabase) — antes se
 *   descartaba al mapear de columnas DB → canónicas. loadAll() ya lo
 *   trae (select('*')); replaceCatalog() ahora relee el catálogo
 *   completo desde Supabase después de insertar en vez de reusar el
 *   array `mapped` derivado del Excel — así el `_id` asignado por
 *   Supabase queda garantizado sin depender de que el orden de
 *   respuesta del INSERT coincida con el orden de envío (no es una
 *   garantía documentada del cliente de Supabase, así que no se asume).
 *
 * FIX (diagnóstico post-carga manual — jul-2026): loadAll() ahora
 * deja rastro explícito en consola de cuántas filas trajo cada tabla.
 * Motivo: si alguien carga las tablas directo en Supabase (CSV import
 * o SQL) en vez de usar el botón "Importar/Reemplazar", catalog_meta
 * nunca se escribe — eso es esperado. Pero si además el SELECT trae 0
 * filas sin ningún error visible, la causa casi siempre es Row Level
 * Security activado sin policy de lectura sobre la tabla nueva (RLS se
 * activa automáticamente al crear una tabla desde el Table Editor de
 * Supabase). Antes esto fallaba en silencio total — ahora queda un log
 * inequívoco para diagnosticarlo sin adivinar.
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

/** Convierte una fila cruda de Supabase (columnas db) a su forma canónica + _id. @private */
function _dbRowToCanonical(catalog, dbRow) {
  const out = { _id: dbRow.id };
  for (const [canon, def] of Object.entries(catalog.columns)) out[canon] = dbRow[def.db] || '';
  return out;
}

/** Actualiza catalog_meta (row_count/updated_at/updated_by) tras cualquier escritura — add/delete/replace. @private */
async function _touchMeta(catalog, rowCount, user) {
  const meta = {
    catalog_id: catalog.id, label: catalog.label,
    row_count: rowCount, updated_at: new Date().toISOString(), updated_by: user || null
  };
  const { error } = await sb.from(META_TABLE).upsert(meta, { onConflict: 'catalog_id' });
  if (error) {
    console.warn('[CatalogStore] No se pudo actualizar metadata:', error.message);
    return;
  }
  State.catalogMeta[catalog.id] = meta;
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
        console.error(`[CatalogStore] Error cargando ${catalog.label} (${catalog.table}):`, error.message);
        State.catalogs[catalog.id] = [];
        continue;
      }
      State.catalogs[catalog.id] = data.map(row => _dbRowToCanonical(catalog, row));

      // Diagnóstico explícito — ver nota de cabecera "FIX". Si aquí sale
      // 0 filas sin error arriba, es casi siempre RLS sin policy de
      // SELECT sobre esta tabla, no un problema del código de la app.
      if (data.length === 0) {
        console.warn(`[CatalogStore] ${catalog.label} (${catalog.table}) trajo 0 filas. ` +
          `Si cargaste datos directo en Supabase y esperabas encontrarlos, revisa Row Level ` +
          `Security en esa tabla — necesita una policy de SELECT para el rol anon.`);
      } else {
        console.log(`[CatalogStore] ${catalog.label}: ${data.length} filas cargadas.`,
          'Ejemplo:', State.catalogs[catalog.id][0]);
      }
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

    // Relectura completa desde Supabase — ver nota de cabecera "CAMBIO
    // (jul-2026)": garantiza que State.catalogs[catalogId] quede con el
    // _id real asignado por Supabase para cada fila, sin asumir que el
    // orden de respuesta del INSERT coincide con `mapped`.
    const { data: freshData, error: freshError } = await sb.from(catalog.table).select('*');
    if (freshError) throw new Error('Catálogo insertado pero no se pudo releer: ' + freshError.message);
    State.catalogs[catalogId] = freshData.map(row => _dbRowToCanonical(catalog, row));

    await _touchMeta(catalog, State.catalogs[catalogId].length, user);

    return { ok: true, count: State.catalogs[catalogId].length };
  },

  /**
   * Agrega UN registro individual a un catálogo maestro, sin afectar
   * al resto — a diferencia de replaceCatalog(), que sustituye todo el
   * contenido. Usado por el panel Administración → Ventana de
   * Recibo/Pool Real (mismo patrón visual e interacción que Licencias).
   *
   * No hace upsert por clave única: un catálogo maestro puede tener
   * legítimamente más de una fila con el mismo valor de índice (eso lo
   * decide y reporta el motor de duplicados — enrichment-engine.js/SVE
   * regla N — no esta función). Solo exige que al menos UNO de los
   * índices declarados del catálogo (catalog.indices) venga con valor —
   * una fila sin ningún índice nunca sería alcanzable por
   * enrichRow()/buildIndices() y no tendría sentido guardarla.
   *
   * @param {string} catalogId — clave en CATALOGS
   * @param {object} values — { columnaCanonica: valor }, ej. { DETTE:'123', FORMATO:'A', TIENDA:'1', ESTADO:'MX' }
   * @param {string} user — State.user, para metadata de auditoría
   * @returns {Promise<object>} la fila insertada, en forma canónica + _id
   * @throws {Error} si el catálogo no existe, falta el índice, o falla Supabase
   */
  async addRow(catalogId, values, user) {
    const catalog = CATALOGS[catalogId];
    if (!catalog) throw new Error('Catálogo desconocido: ' + catalogId);

    const dbRow = {};
    for (const [canon, def] of Object.entries(catalog.columns)) {
      dbRow[def.db] = String((values && values[canon]) ?? '').trim();
    }
    const hasIndex = catalog.indices.some(idx => dbRow[catalog.columns[idx].db]);
    if (!hasIndex) {
      throw new Error(`Captura al menos ${catalog.indices.join(' o ')} para poder guardar el registro.`);
    }

    const { data, error } = await sb.from(catalog.table).insert(dbRow).select().single();
    if (error) throw new Error('No se pudo agregar el registro: ' + error.message);

    const row = _dbRowToCanonical(catalog, data);
    State.catalogs[catalogId] = [...(State.catalogs[catalogId] || []), row];

    await _touchMeta(catalog, State.catalogs[catalogId].length, user);
    return row;
  },

  /**
   * Elimina UN registro individual de un catálogo maestro por su _id
   * (uuid primario de Supabase).
   *
   * @param {string} catalogId — clave en CATALOGS
   * @param {string} id — _id del registro (ver _dbRowToCanonical)
   * @param {string} user — State.user, para metadata de auditoría
   * @returns {Promise<void>}
   * @throws {Error} si el catálogo no existe o falla Supabase
   */
  async deleteRow(catalogId, id, user) {
    const catalog = CATALOGS[catalogId];
    if (!catalog) throw new Error('Catálogo desconocido: ' + catalogId);
    if (!id) throw new Error('Registro sin identificador — no se puede eliminar.');

    const { error } = await sb.from(catalog.table).delete().eq('id', id);
    if (error) throw new Error('No se pudo eliminar el registro: ' + error.message);

    State.catalogs[catalogId] = (State.catalogs[catalogId] || []).filter(r => r._id !== id);
    await _touchMeta(catalog, State.catalogs[catalogId].length, user);
  }
};
