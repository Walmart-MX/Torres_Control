/**
 * features/catalog.js
 * Gestión del catálogo de operadores — Fase 1 de Camino B (Supabase).
 *
 * CAMBIO DE ARQUITECTURA respecto a Camino A:
 *   Antes: el catálogo vivía como array embebido en index.html
 *     (CATALOG_DATA) y saveCatalog() persistía descargando un HTML
 *     completo con el array actualizado — una copia local por usuario,
 *     sin compartir entre operadores de captura.
 *   Ahora: el catálogo vive en la tabla `operators` de Supabase.
 *     State.catalog sigue siendo un Map en memoria (op_name → lic) —
 *     funciona como caché local de lectura rápida para merge.js y
 *     ui.js, pero la fuente de verdad es la base de datos. Cada
 *     escritura (agregar/eliminar/importar) persiste inmediatamente
 *     en Supabase antes de actualizar el Map local.
 *
 *   saveCatalog() desaparece por completo — ya no existe un paso manual
 *   de "guardar". El botón correspondiente y su listener se eliminan
 *   de index.html / app.js.
 *
 * Requisito de esquema: la tabla `operators` necesita un índice único
 * en la columna `op_name` (no en op_name+lic) para que el upsert de
 * addOperator()/importOperators() sobreescriba la licencia de un
 * operador existente en vez de crear una fila duplicada:
 *
 *   drop index if exists operators_name_lic_idx;
 *   alter table operators add constraint operators_op_name_key unique (op_name);
 *
 * Dependencias:
 *   - State (core/state.js) — lee y escribe State.catalog (caché local)
 *   - normOp (utils/format.js) — normaliza nombre de operador como clave
 *   - sb (core/supabase-client.js) — cliente Supabase compartido
 */
import { State } from '../core/state.js';
import { normOp } from '../utils/format.js';
import { sb } from '../core/supabase-client.js';

const TABLE = 'operators';

/**
 * Carga el catálogo completo desde Supabase hacia State.catalog.
 * Se llama una vez al iniciar la app (ver core/app.js).
 *
 * @returns {Promise<{ ok: boolean, msg: string }>}
 */
export async function initCatalog() {
  State.catalog = new Map();
  const { data, error } = await sb.from(TABLE).select('op_name, lic');
  if (error) {
    console.error('[Catalog] Error cargando catálogo desde Supabase:', error.message);
    return { ok: false, msg: 'No se pudo cargar el catálogo — revisa tu conexión' };
  }
  for (const { op_name, lic } of data) {
    State.catalog.set(op_name, lic);
  }
  return { ok: true, msg: `${data.length} operador${data.length !== 1 ? 'es' : ''} cargado${data.length !== 1 ? 's' : ''}` };
}

/**
 * Agrega o actualiza un operador — upsert por op_name (clave única en DB).
 * Si el operador ya existe, su licencia se sobreescribe (mismo comportamiento
 * que State.catalog.set() en el Map original de Camino A).
 *
 * @param {string} op — nombre del operador (se normaliza internamente)
 * @param {string} lic — número de licencia
 * @returns {Promise<{ ok: boolean, msg: string, cls: 'ok'|'err' }>}
 */
export async function addOperator(op, lic) {
  const opName = normOp(op);
  const licVal = String(lic || '').trim();
  const { error } = await sb.from(TABLE)
    .upsert({ op_name: opName, lic: licVal }, { onConflict: 'op_name' });
  if (error) {
    console.error('[Catalog] Error agregando operador:', error.message);
    return { ok: false, msg: 'Error al guardar — ' + error.message, cls: 'err' };
  }
  State.catalog.set(opName, licVal);
  return { ok: true, msg: '✓ Agregado', cls: 'ok' };
}

/**
 * Elimina un operador del catálogo (DB + caché local).
 *
 * @param {string} op — nombre del operador
 * @returns {Promise<{ ok: boolean, msg: string, cls: 'ok'|'err' }>}
 */
export async function deleteOperator(op) {
  const opName = normOp(op);
  const { error } = await sb.from(TABLE).delete().eq('op_name', opName);
  if (error) {
    console.error('[Catalog] Error eliminando operador:', error.message);
    return { ok: false, msg: 'Error al eliminar — ' + error.message, cls: 'err' };
  }
  State.catalog.delete(opName);
  return { ok: true, msg: 'Eliminado', cls: 'ok' };
}

/**
 * Importa múltiples operadores en una sola operación (upsert masivo).
 * Usado por Events.importCatalog() al leer un Excel.
 *
 * @param {Array<{op: string, lic: string}>} entries
 * @returns {Promise<{ ok: boolean, msg: string, cls: 'ok'|'err', added: number }>}
 */
export async function importOperators(entries) {
  const rows = entries
    .map(({ op, lic }) => ({ op_name: normOp(op), lic: String(lic || '').trim() }))
    .filter(r => r.op_name && r.lic);

  if (!rows.length) {
    return { ok: false, msg: 'Sin filas válidas para importar', cls: 'err', added: 0 };
  }

  const { error } = await sb.from(TABLE).upsert(rows, { onConflict: 'op_name' });
  if (error) {
    console.error('[Catalog] Error importando catálogo:', error.message);
    return { ok: false, msg: 'Error al importar — ' + error.message, cls: 'err', added: 0 };
  }
  for (const r of rows) State.catalog.set(r.op_name, r.lic);
  return { ok: true, msg: `✓ ${rows.length} operadores importados`, cls: 'ok', added: rows.length };
}
