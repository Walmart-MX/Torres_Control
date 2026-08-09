/**
 * features/route-postprocess.js
 * POST-PROCESO DE RUTA — reemplazo nativo de la macro VBA
 * `POST_PROCESO_UNIFICADO_FINAL`. Fase 2 de la migración de la Macro
 * Despacho (ago-2026).
 *
 * ALCANCE DE ESTA FASE (deliberadamente acotado — ver especificación
 * funcional compartida con EduarDo):
 *   SÍ incluye: fill-down de RUTA/SETEO/UNIDAD/CORTINA/LLEGADA/T.E/
 *   T.R/SOLICITUD/FORMADO/ENRAMPE/RETIRO/CASETA por ruta, el fallback
 *   TRACTOR=UNIDAD, y la normalización de SETEO (tabla cerrada de 3
 *   valores).
 *
 *   NO incluye (deferido a fases posteriores, ver notas abajo):
 *     - Corrección de cruce de medianoche (umbral CEDIS_CLOSE_HOUR,
 *       ver core/constants.js). Los campos de tiempo (LLEGADA, T.E,
 *       T.R, SOLICITUD, FORMADO, ENRAMPE, RETIRO, CASETA) que llegan
 *       en el Excel YA vienen corregidos — esa corrección la aplica
 *       `ArbeyJr` en sus pasos 0-10, que esta fase NO reemplaza
 *       todavía (solo reemplaza `POST_PROCESO_UNIFICADO_FINAL`, que
 *       corre DESPUÉS de ArbeyJr). Aplicar el umbral aquí corregiría
 *       un dato que ya está corregido — se deja documentado en
 *       constants.js para cuando una fase futura reemplace también el
 *       procesamiento crudo de columnas de ArbeyJr.
 *     - Generación de determinantes ENT1/2/3.../nU. Confirmado con
 *       datos reales (Excel ANTES/DESPUÉS + PDFs, ago-2026): en el
 *       proceso actual, esta numeración SIEMPRE corre sobre datos ya
 *       consolidados (la revisión manual de HUB ocurre ANTES de
 *       POST_PROCESO). Generarla aquí, sobre filas todavía sin
 *       consolidar (una fila por factura en rutas con HUB), numeraría
 *       cada factura como una entrega separada — un estado que nunca
 *       existió en el proceso real, no una versión "parcial" válida.
 *       Se difiere a la Fase 3 (features/hub-consolidation.js), que
 *       corre justo antes y deja las filas ya consolidadas por
 *       destino real — recién ahí la numeración es correcta.
 *
 * DISEÑO — por qué es seguro correrlo siempre, sin importar si el
 * Excel cargado ya viene completamente procesado por la macro (flujo
 * actual) o si es el "Esqueleto" crudo de ArbeyJr sin
 * POST_PROCESO_UNIFICADO_FINAL (flujo nuevo que esta fase habilita):
 *   - Si el Excel ya viene con todo lleno (flujo actual): el fill-down
 *     no encuentra nada vacío que rellenar — no-op.
 *   - Si el SETEO ya viene traducido ("REFRI"/"FRUTA"/"CONGE"): el
 *     match exacto contra SETEO_MAP no dispara — no-op (SETEO_MAP solo
 *     reemplaza cuando el valor es EXACTAMENTE uno de los 3 códigos
 *     crudos "3°C"/"4°C"/"-26°C").
 *   - Si el Excel es el "Esqueleto" crudo: el fill-down SÍ hace
 *     trabajo real, permitiendo saltarse POST_PROCESO_UNIFICADO_FINAL
 *     manualmente (salvo la numeración de determinantes, ver arriba).
 * Mismo criterio de seguridad que ya usa enrichment-engine.js cuando
 * un catálogo no está cargado — nunca falla, nunca corrompe datos ya
 * correctos.
 *
 * ALGORITMO — fiel a POST_PROCESO_UNIFICADO_FINAL (VBA), confirmado
 * con datos reales:
 *   1. RUTA se rellena PRIMERO y por separado — establece el límite de
 *      cada grupo de ruta; todo lo demás se rellena DENTRO de ese
 *      límite ya resuelto (si se hiciera junto con lo demás, no
 *      habría forma de saber dónde termina una ruta y empieza otra).
 *   2. El resto de las columnas de FILL_DOWN_COLS se rellena en un
 *      solo recorrido, reiniciando el "último valor conocido" cada vez
 *      que cambia RUTA.
 *   3. TRACTOR se procesa aparte, en el mismo recorrido: mismo
 *      fill-down que el resto, PERO si la PRIMERA fila de una ruta no
 *      trae tractor capturado, se usa el valor de UNIDAD como
 *      sustituto — confirmado por EduarDo que debe preservarse
 *      exactamente igual, para no alterar el resultado de RUTEO NUEVO.
 *   4. SETEO se normaliza al final, con coincidencia EXACTA de celda
 *      completa (no de subcadena) — igual que el `Range.Replace` de la
 *      macro original.
 *
 * Dependencias:
 *   - SETEO_MAP (core/constants.js) — tabla cerrada de 3 valores,
 *     confirmada con EduarDo como completa
 */
import { SETEO_MAP } from '../core/constants.js';

/**
 * Columnas de RUTEO NUEVO que se rellenan por arrastre (fill-down)
 * dentro de cada ruta — todas comparten el mismo criterio: son
 * atributos de la ruta/entrega física completa, capturados una sola
 * vez en la primera fila y repetidos por WMS en las filas siguientes
 * como celdas vacías. TRACTOR se maneja aparte (ver _fillTractor) por
 * su regla de fallback especial — no vive en esta lista para no
 * duplicar su procesamiento.
 */
export const ROUTE_FILL_DOWN_COLS = [
  'SETEO', 'UNIDAD', 'CORTINA',
  'LLEGADA', 'T.E', 'T.R', 'SOLICITUD', 'FORMADO', 'ENRAMPE', 'RETIRO', 'CASETA'
];

/** @private */
function _isBlank(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/**
 * Rellena RUTA por arrastre — debe correr ANTES que cualquier otra
 * columna, porque establece el límite de cada grupo de ruta que el
 * resto del fill-down necesita. @private
 * @param {Array<object>} rows — mutado in-place
 */
function _fillRuta(rows) {
  let last = '';
  rows.forEach(r => {
    if (!_isBlank(r['RUTA'])) last = r['RUTA'];
    else r['RUTA'] = last;
  });
}

/**
 * Rellena ROUTE_FILL_DOWN_COLS + TRACTOR (con su fallback especial) en
 * un solo recorrido, reiniciando el estado cada vez que cambia RUTA
 * (RUTA ya debe estar resuelta por _fillRuta() antes de llamar esto).
 * @private
 * @param {Array<object>} rows — mutado in-place, requiere RUTA ya rellenada
 */
function _fillRouteAttributes(rows) {
  let currentRuta = Symbol('none'); // nunca igual a un valor real de RUTA — fuerza el reset en la primera fila
  let last = {};

  rows.forEach(r => {
    if (r['RUTA'] !== currentRuta) {
      currentRuta = r['RUTA'];
      last = { TRACTOR: '' };
      ROUTE_FILL_DOWN_COLS.forEach(c => { last[c] = ''; });
    }

    // UNIDAD (y el resto) se resuelven ANTES del bloque de TRACTOR —
    // el fallback de TRACTOR necesita leer r['UNIDAD'] ya rellenada de
    // ESTA misma fila si es la primera de la ruta.
    ROUTE_FILL_DOWN_COLS.forEach(c => {
      if (!_isBlank(r[c])) last[c] = r[c];
      else r[c] = last[c];
    });

    if (!_isBlank(r['TRACTOR'])) {
      last.TRACTOR = r['TRACTOR'];
    } else if (last.TRACTOR) {
      r['TRACTOR'] = last.TRACTOR;
    } else {
      // Primera fila de la ruta, sin tractor capturado — fallback
      // confirmado: usar el mismo valor que UNIDAD (ver nota de
      // cabecera, punto 3 del algoritmo).
      r['TRACTOR'] = r['UNIDAD'] || '';
      last.TRACTOR = r['TRACTOR'];
    }
  });
}

/**
 * Normaliza SETEO contra la tabla cerrada de 3 valores — coincidencia
 * EXACTA de celda completa. Valores fuera de la tabla (incluido vacío)
 * se dejan sin tocar. @private
 * @param {Array<object>} rows — mutado in-place
 */
function _normalizeSeteo(rows) {
  rows.forEach(r => {
    const v = String(r['SETEO'] ?? '').trim();
    if (SETEO_MAP[v]) r['SETEO'] = SETEO_MAP[v];
  });
}

/**
 * Aplica el post-proceso completo de ruta sobre las filas crudas de
 * RUTEO NUEVO (State.xlsData) — fill-down + normalización de SETEO.
 * Función pura salvo por la mutación in-place de `rows` (mismo
 * contrato que el resto de los engines del proyecto, ej.
 * core/time-engine.js → computeTimes()).
 *
 * @param {Array<object>} rows — filas crudas de RUTEO NUEVO (salida de
 *   processors/excel.js → processXLS().rows)
 * @returns {Array<object>} las mismas `rows`, mutadas, para permitir
 *   encadenar en el punto de llamada
 */
export function applyRoutePostprocess(rows) {
  if (!rows || !rows.length) return rows;
  _fillRuta(rows);
  _fillRouteAttributes(rows);
  _normalizeSeteo(rows);
  return rows;
}
