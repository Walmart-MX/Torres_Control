/**
 * features/hub-consolidation.js
 * CONSOLIDACIÓN AUTOMÁTICA DE HUB — Fase 3 de la migración de la Macro
 * Despacho (ago-2026). Reemplaza la revisión manual que hoy hace
 * EduarDo entre el "Esqueleto" (salida de `ArbeyJr`) y
 * `POST_PROCESO_UNIFICADO_FINAL`: eliminar filas y corregir
 * determinantes cuando varias facturas de RUTEO NUEVO en realidad
 * pertenecen a UNA sola entrega física por HUB.
 *
 * REGLA — validada con datos reales (Excel ANTES/DESPUÉS + PDFs reales
 * de las rutas 3105/3106/3107/3108, ago-2026), NO con heurística:
 *   Cada fila cruda de RUTEO NUEVO representa una factura individual.
 *   `merge.js` ya resuelve, por fila, el bloque de PDF que le
 *   corresponde (match específico por ruta+factura) — ese bloque trae
 *   el `destino` REAL (HUB o tienda), guardado en `nr['DEST_PDF']`.
 *   Agrupar las filas de una misma ruta por ese destino real: cualquier
 *   grupo con más de una fila se colapsa en una sola.
 *
 *   Confirmado por EduarDo: en la práctica esto SIEMPRE resulta ser un
 *   HUB — las tiendas nunca se repiten dentro de la misma ruta — pero
 *   el código NO distingue "HUB" de "tienda" de forma explícita: el
 *   tamaño del grupo ya lo resuelve, sin ninguna heurística de
 *   contenido (nunca se mira si el destino "parece" un HUB por su
 *   formato de número o similar).
 *
 * QUÉ SE CONSOLIDA Y CÓMO — confirmado por EduarDo (ronda 2):
 *   - DETTE ← destino real (el número de HUB)
 *   - CAJAS y TARIMAS (cantidades por factura) ← SUMA de todas las
 *     filas del grupo — CAJAS es un campo propio de RUTEO NUEVO;
 *     TARIMAS viene del PDF (pdfRow.tarimas) pero es EXACTAMENTE la
 *     misma granularidad — una cantidad por factura, no por ruta — así
 *     que se suma con el mismo criterio.
 *   - MARCHAMO 1-5 ← mismo criterio que processors/pdf.js →
 *     _dedupeByDestino(): NUNCA se asume que "la primera factura del
 *     grupo" trae el marchamo — WMS solo lo imprime en una posición
 *     del manifiesto, no necesariamente en la primera. Se toma el
 *     valor de CUALQUIERA de las facturas del grupo que sí lo traiga,
 *     por posición (MARCHAMO 1 de cualquiera, MARCHAMO 2 de
 *     cualquiera, etc.). _marchamoIssues (diagnóstico) se concatena
 *     de todas las facturas del grupo, sin descartar ninguna.
 *   - Todo lo demás (RUTA, SETEO, TRACTOR, UNIDAD, CORTINA, tiempos,
 *     OPERADOR, LIC., FAC_PDF, CITA…) ← valor de la PRIMERA fila del
 *     grupo en orden de aparición — son atributos de la ruta/entrega
 *     completa, ya idénticos entre todas las filas del grupo (vienen
 *     del mismo PDF/despacho), no varían por factura individual.
 *
 * CATÁLOGO DE EXCLUSIÓN — determinantes de HUB que NO representan
 * entregas reales, usados únicamente para registrar rutas alternas
 * (confirmado por EduarDo: `29999138` y `29999230`, semilla inicial de
 * `catalog_hub_exclusions` — ver features/catalogs/catalog-registry.js).
 * Cualquier fila cuyo destino esté en esta lista NUNCA entra al
 * agrupamiento — se deja tal cual, sin excepción y sin heurística.
 *
 * DÓNDE CORRE — invocado desde processors/merge.js DESPUÉS de que el
 * loop principal ya resolvió el match de PDF/factura/despacho/WTMS
 * para cada fila (necesita `nr['DEST_PDF']` ya resuelto), pero ANTES
 * del enrichment de catálogos maestros y del motor de tiempos — ambos
 * deben correr sobre el DETTE ya FINAL (post-consolidación), no sobre
 * el DETTE de cada factura individual. Ver processors/merge.js para
 * el detalle completo del reordenamiento del pipeline.
 *
 * DEPENDENCIA CONOCIDA (a validar en producción, no resuelta por esta
 * fase): la precisión del agrupamiento depende de que
 * `nr['DEST_PDF']` esté bien resuelto para cada factura — lo cual a su
 * vez depende de que `row['FACTURAS']` (columna propia de RUTEO NUEVO)
 * esté correctamente poblada fila por fila. Hoy esa columna llega vía
 * el pegado POSICIONAL de `ArbeyJr` (paso 12) — el mismo riesgo ya
 * señalado en la especificación funcional (sección 1.2, "Regla de
 * negocio oculta #5"). Esta fase NO reemplaza ese pegado — asume que
 * la columna FACTURAS de RUTEO NUEVO ya está bien poblada al llegar
 * aquí. Si en producción se observan consolidaciones incorrectas, el
 * origen más probable es ese pegado posicional, no la lógica de
 * agrupamiento de este módulo.
 *
 * Dependencias: ninguna de otros módulos propios — funciones puras,
 * reciben todo por parámetro (mismo criterio que enrichment-engine.js).
 */

/** Campos numéricos "por factura" que se suman al consolidar un grupo — ver nota de cabecera. */
const NUMERIC_SUM_COLS = ['CAJAS', 'TARIMAS'];

/** @private */
function _toInt(v) {
  const n = parseInt(String(v ?? '0').replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * Combina un grupo de filas (misma ruta+destino) en una sola fila
 * consolidada — ver nota de cabecera para el detalle campo por campo.
 * @private
 * @param {Array<object>} groupRows — filas del grupo, en orden de aparición
 * @param {string} destino
 * @returns {object} la fila consolidada
 */
function _mergeGroup(groupRows, destino) {
  const merged = { ...groupRows[0], DETTE: destino };

  NUMERIC_SUM_COLS.forEach(col => {
    merged[col] = groupRows.reduce((sum, r) => sum + _toInt(r[col]), 0);
  });

  for (let m = 1; m <= 5; m++) {
    const key = 'MARCHAMO ' + m;
    const withValue = groupRows.find(r => String(r[key] || '').trim());
    merged[key] = withValue ? withValue[key] : '';
  }
  merged['_marchamoIssues'] = groupRows.flatMap(r => r._marchamoIssues || []);

  // Marca de trazabilidad — leída por features/validation/sve.js
  // (regla 'hub_consolidated', informativa) para reportar exactamente
  // qué facturas se fusionaron y cuántas, sin ocurrir nunca en
  // silencio.
  merged['_hubConsolidated'] = {
    destino,
    originalDettes: groupRows.map(r => String(r['DETTE'] || '').trim()),
    count: groupRows.length
  };

  return merged;
}

/**
 * Agrupa las filas ya resueltas (con `DEST_PDF` asignado por el match
 * de PDF en merge.js) por (ruta, destino) y colapsa los grupos de
 * tamaño > 1. Preserva el ORDEN ORIGINAL de aparición — la fila
 * consolidada ocupa la posición de la PRIMERA factura del grupo; el
 * resto de las facturas absorbidas se eliminan del array de salida.
 *
 * @param {Array<object>} rows — filas `nr` ya construidas por el loop
 *   principal de merge.js, con `DEST_PDF` resuelto donde aplique
 * @param {Set<string>} excludedDeterminantes — valores de destino que
 *   nunca se agrupan (catálogo de exclusión, ver nota de cabecera)
 * @returns {Array<object>} nuevo array de filas, con los grupos ya
 *   consolidados — mismo orden relativo que `rows`
 */
export function consolidateHubs(rows, excludedDeterminantes) {
  const groupsByKey = new Map();

  rows.forEach(r => {
    const destino = String(r['DEST_PDF'] || '').trim();
    if (!destino || excludedDeterminantes.has(destino)) return; // sin destino resuelto, o excluido explícitamente — nunca se agrupa
    const key = String(r['RUTA'] || '').trim() + '||' + destino;
    if (!groupsByKey.has(key)) groupsByKey.set(key, []);
    groupsByKey.get(key).push(r);
  });

  const replacementByFirstRow = new Map(); // fila original (primera del grupo) → fila consolidada
  const absorbedRows = new Set();          // filas del grupo distintas de la primera — se descartan

  groupsByKey.forEach((groupRows, key) => {
    if (groupRows.length < 2) return; // grupo de tamaño 1 — nada que consolidar
    const destino = key.split('||')[1];
    const merged  = _mergeGroup(groupRows, destino);
    replacementByFirstRow.set(groupRows[0], merged);
    groupRows.slice(1).forEach(r => absorbedRows.add(r));
  });

  const out = [];
  rows.forEach(r => {
    if (absorbedRows.has(r)) return;
    out.push(replacementByFirstRow.get(r) || r);
  });
  return out;
}

/**
 * Genera los determinantes ENT1/2/3.../nU sobre filas YA consolidadas
 * — reemplazo nativo de `POST_PROCESO_UNIFICADO_FINAL` (sección
 * "ENTREGAS POR RUTA" de la macro VBA). DEBE correr después de
 * consolidateHubs() — numerar antes de consolidar produciría una
 * numeración que nunca existió en el proceso real (cada factura de un
 * HUB contaría como una entrega separada). Validado con los 4 casos
 * reales (rutas 3105/3106/3107/3108): primera fila de cada ruta →
 * texto literal "ENT1"; filas siguientes → número secuencial; última
 * fila de una ruta multi-entrega → sufijo "U" agregado al número
 * (nunca al texto "ENT1", así que una ruta de una sola entrega se
 * queda tal cual, sin sufijo).
 *
 * Asume que las filas de una misma ruta llegan CONTIGUAS en `rows` —
 * mismo supuesto que ya usa features/route-postprocess.js (RUTEO
 * NUEVO siempre trae las entregas de una ruta en filas consecutivas).
 *
 * @param {Array<object>} rows — mutadas in-place (rows[i]['ENT1'])
 * @returns {Array<object>} las mismas `rows`, para permitir encadenar
 */
export function assignDeterminants(rows) {
  let i = 0;
  while (i < rows.length) {
    const ruta = rows[i]['RUTA'];
    let j = i;
    while (j < rows.length && rows[j]['RUTA'] === ruta) j++;

    for (let k = i; k < j; k++) {
      rows[k]['ENT1'] = k === i ? 'ENT1' : String(k - i + 1);
    }
    const lastIdx = j - 1;
    if (lastIdx > i) rows[lastIdx]['ENT1'] = String(rows[lastIdx]['ENT1']) + 'U';

    i = j;
  }
  return rows;
}
