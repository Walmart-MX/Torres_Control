/**
 * processors/unified-routes.js
 * Asigna cada bloque (remolque) de un PDF de ruta unificada ("4107-4108.pdf")
 * a su ruta REAL usando como evidencia el Excel macro (RUTEO NUEVO).
 *
 * POR QUE EXISTE: el PDF de una carga doble imprime dos bloques de
 * entregas (uno por remolque) pero NO dice cual remolque es cual ruta.
 * parsePDF() asume "primer bloque = ruta de numero MAYOR" (cierto en
 * 1205-1206), pero en 4107-4108 el Excel asigna 3505/3632 a 4107 (la
 * MENOR) y 1124/1004 a 4108 -> las 4 tiendas quedaban sin cruzar. El
 * unico dato confiable de quien lleva que es el plan del dia (Excel).
 *
 * COMO: parsePDF() etiqueta cada fila con `bloque` (0 = primero impreso)
 * y `rutasPar` ([mayor, menor]). Aqui se puntua cada asignacion posible
 * (por defecto vs. invertida) contando cuantas filas del bloque aparecen
 * en el Excel de esa ruta (por destino o por factura) y se elige la de
 * mayor puntaje. EMPATE -> regla historica (sin cambios) -- tipico en
 * cargas HUB donde ambas rutas comparten destino, donde el Excel no
 * puede desempatar.
 *
 * Idempotente: depende solo de `bloque`/`rutasPar` (inmutables) y del
 * Excel, nunca del `ruta` actual de la fila -> correrlo N veces, o tras
 * restaurar un autosave, da el mismo resultado. Puro: solo muta los
 * objetos/Map que recibe; sin State, sin DOM.
 *
 * Dependencias: COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT (core/constants.js)
 */
import { COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT } from '../core/constants.js';

const _str = v => String(v ?? '').trim();

/** Excel -> Map<ruta, {destinos:Set, facturas:Set}>. @private */
function _excelEvidence(xlsRows) {
  const byRuta = new Map();
  for (const row of xlsRows) {
    const ruta = _str(row[COL_RUTA]);
    if (!ruta) continue;
    if (!byRuta.has(ruta)) byRuta.set(ruta, { destinos: new Set(), facturas: new Set() });
    const ev = byRuta.get(ruta);
    [row[COL_DETTE_F], row[COL_DETTE_E]].map(_str).filter(Boolean).forEach(d => ev.destinos.add(d));
    const fact = _str(row[COL_FACT]);
    if (fact) ev.facturas.add(fact);
  }
  return byRuta;
}

/** Cuantas filas del bloque aparecen en el Excel de esa ruta. @private */
function _score(blockRows, ev) {
  if (!ev) return 0;
  return blockRows.filter(r => ev.destinos.has(r.destino) || ev.facturas.has(r.factura)).length;
}

/** Agrupa las filas de unificadas por par de rutas: Map<'mayor-menor', [bloque0[], bloque1[]]>. @private */
function _groupPairs(pdfData) {
  const pairs = new Map();
  for (const row of new Set(pdfData.values())) {
    if (!row.rutasPar || row.bloque === undefined) continue;
    const key = row.rutasPar.join('-');
    if (!pairs.has(key)) pairs.set(key, { rutasPar: row.rutasPar, blocks: [[], []] });
    pairs.get(key).blocks[row.bloque]?.push(row);
  }
  return [...pairs.values()];
}

/**
 * Reasigna in-place `ruta` de las filas de PDFs unificados segun el Excel y
 * reindexa en `pdfData` solo las filas que cambiaron (mismas claves que
 * events.js: `ruta|factura` y `ruta|D|destino`).
 * @param {Map<string,object>} pdfData  State.pdfData
 * @param {Array<object>} xlsRows       State.xlsData
 * @returns {number} cantidad de pares de rutas cuya asignacion CAMBIO en
 *   esta llamada (0 en corridas repetidas -> idempotente)
 */
export function reconcileUnifiedRoutes(pdfData, xlsRows) {
  if (!pdfData.size || !xlsRows || !xlsRows.length) return 0;
  const evidence = _excelEvidence(xlsRows);
  const changed = new Set();
  let swappedPairs = 0;

  for (const { rutasPar: [hi, lo], blocks: [b0, b1] } of _groupPairs(pdfData)) {
    const keep = _score(b0, evidence.get(hi)) + _score(b1, evidence.get(lo));
    const swap = _score(b0, evidence.get(lo)) + _score(b1, evidence.get(hi));
    const [ruta0, ruta1] = swap > keep ? [lo, hi] : [hi, lo];
    const before = changed.size;
    b0.forEach(r => { if (r.ruta !== ruta0) { r.ruta = ruta0; changed.add(r); } });
    b1.forEach(r => { if (r.ruta !== ruta1) { r.ruta = ruta1; changed.add(r); } });
    if (changed.size > before) swappedPairs++;
  }

  if (changed.size) {
    for (const [key, row] of pdfData) if (changed.has(row)) pdfData.delete(key);
    for (const r of changed) {
      if (r.factura) pdfData.set(r.ruta + '|' + r.factura, r);
      if (r.destino) pdfData.set(r.ruta + '|D|' + r.destino, r);
    }
  }
  return swappedPairs;
}
