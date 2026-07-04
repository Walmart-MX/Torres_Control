/**
 * features/catalog.js
 * Gestión del catálogo de operadores: inicialización desde el array
 * embebido en HTML y guardado (serialización + descarga del HTML modificado).
 *
 * CAMBIO DE INTERFAZ (misma inversión de control que SVE en Fase 6):
 *   initCatalog(catalogData) — recibe el array CATALOG_DATA como parámetro
 *     en vez de leerlo directamente (evita dependencia del módulo hacia
 *     el scope global del HTML). Devuelve void; el caller llama UI.renderCatalog().
 *   saveCatalog() — devuelve { ok: boolean, msg: string, cls: string }
 *     en vez de llamar UI.setCatStatus() directamente. El caller decide
 *     qué hacer con ese resultado.
 *
 * NOTA sobre saveCatalog y el slot CATALOG_JSON_START/END:
 *   Esta función descarga el HTML completo de la página con el catálogo
 *   actualizado embebido — técnica heredada del monolito original. Funciona
 *   correctamente mientras el slot esté presente en el HTML. Esta función
 *   desaparecerá en la fase de integración con Supabase, cuando el catálogo
 *   migre a la tabla `operators` de la base de datos.
 *
 * Dependencias:
 *   - State (core/state.js) — lee y escribe State.catalog
 *   - normOp (utils/format.js) — normaliza nombre de operador como clave
 */
import { State } from '../core/state.js';
import { normOp } from '../utils/format.js';

/**
 * Inicializa State.catalog desde el array de datos del catálogo embebido.
 * El array se pasa como parámetro desde el caller (index.html) para
 * evitar dependencia directa del módulo hacia el scope global del HTML.
 *
 * @param {Array<{op: string, lic: string}>} catalogData
 */
export function initCatalog(catalogData) {
  State.catalog = new Map();
  for (const { op, lic } of catalogData) {
    State.catalog.set(normOp(op), lic);
  }
}

/**
 * Serializa State.catalog, lo embebe en el HTML actual dentro del slot
 * CATALOG_JSON_START/END, y dispara la descarga del archivo resultante.
 *
 * @returns {{ ok: boolean, msg: string, cls: 'ok'|'err' }}
 */
export function saveCatalog() {
  const entries = [...State.catalog.entries()].map(([op, lic]) => ({ op, lic }));
  const json    = JSON.stringify(entries);
  let html      = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  const START   = '/*CATALOG_JSON_START*/';
  const END     = '/*CATALOG_JSON_END*/';
  const s = html.indexOf(START), e = html.indexOf(END);
  if (s === -1 || e === -1) {
    return { ok: false, msg: 'No se encontró el slot — recarga la página', cls: 'err' };
  }
  html = html.slice(0, s + START.length) + json + html.slice(e);
  const blob = new Blob([html], { type: 'text/html' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'SmartDispatch-v2.html';
  a.click();
  URL.revokeObjectURL(a.href);
  return { ok: true, msg: `✓ Guardado con ${entries.length} operadores`, cls: 'ok' };
}
