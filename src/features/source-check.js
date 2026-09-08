/**
 * features/source-check.js
 * SOURCE CHECK — comparador liviano e informativo entre las rutas/entregas
 * detectadas en el Excel macro (RUTEO NUEVO) y las detectadas en los PDFs
 * de carga. Pensado para dar visibilidad temprana en Preparación —
 * disponible en cuanto Excel + PDF están cargados, sin esperar a las
 * otras 2 fuentes obligatorias (WTMS / Status de despacho).
 *
 * NO ES LA FUENTE DE VERDAD DE INTEGRIDAD — esa sigue siendo
 * features/validation/sve.js (reglas 'pdf_ambiguous' / 'dette_sin_pdf'),
 * que corre sobre el resultado real de processors/merge.js, con toda su
 * lógica de prioridad de match, fallback seguro por ruta y distinción
 * ambigüedad-real vs entrega-ausente. Este módulo es deliberadamente más
 * simple: compara únicamente por clave "ruta||entrega", sin reproducir
 * esa lógica — el objetivo es un vistazo rápido en Preparación, no una
 * segunda fuente de verdad. Por diseño es puramente informativo: nunca
 * escribe en State, nunca bloquea el merge ni la exportación (ver
 * events.js/ui.js, que solo lo usan para pintar una tarjeta).
 *
 * Clave de comparación:
 *   - Excel: ruta + (DETTE.1 || DETTE) — mismo criterio de campo que ya
 *     usa processors/merge.js para armar _rowId.
 *   - PDF: ruta + destino, deduplicado por REFERENCIA de objeto — un
 *     mismo bloque de State.pdfData puede estar indexado dos veces
 *     (por factura y por destino, ver events.js → handlePDFs()); sin
 *     este dedupe un mismo bloque físico se contaría dos veces. Mismo
 *     truco que ya usa merge.js en su fallback por ruta.
 *
 * Función pura de solo lectura sobre State — no lo muta, no importa
 * Supabase, no participa en runMerge()/runSVE()/exportación.
 *
 * Dependencias:
 *   - State (core/state.js) — lee State.xlsData / State.pdfData
 *   - COL_RUTA, COL_DETTE_E, COL_DETTE_F (core/constants.js)
 */
import { State } from '../core/state.js';
import { COL_RUTA, COL_DETTE_E, COL_DETTE_F } from '../core/constants.js';

/** Formatea una clave interna "ruta||entrega" a texto legible "ruta · entrega". @private */
function _fmtKey(key) {
  const [ruta, entrega] = key.split('||');
  return entrega ? `${ruta} · ${entrega}` : ruta;
}

/**
 * Compara Excel vs PDF por clave ruta+entrega.
 *
 * @returns {null|{
 *   excelCount:number, pdfCount:number, matchCount:number, diffCount:number,
 *   missingInPdf:string[], onlyInPdf:string[], status:'ok'|'warn'
 * }} — null si falta el Excel o no hay ningún PDF cargado (mismo guard
 *   conceptual que runMerge() usa para decidir si hay algo que cruzar).
 *   missingInPdf/onlyInPdf ya vienen formateados para mostrar tal cual
 *   en la UI ("ruta · entrega").
 */
export function compareExcelPdf() {
  if (!State.xlsData || !State.xlsData.length || State.pdfData.size === 0) return null;

  const excelKeys = new Set();
  for (const row of State.xlsData) {
    const ruta = String(row[COL_RUTA] || '').trim();
    if (!ruta) continue;
    const detteF  = String(row[COL_DETTE_F] || '').trim();
    const detteE  = String(row[COL_DETTE_E] || '').trim();
    const entrega = detteF || detteE;
    excelKeys.add(ruta + '||' + entrega);
  }

  const seen = new Set();
  const pdfKeys = new Set();
  for (const [, block] of State.pdfData) {
    if (seen.has(block)) continue;
    seen.add(block);
    const ruta = String(block.ruta || '').trim();
    if (!ruta) continue;
    pdfKeys.add(ruta + '||' + String(block.destino || '').trim());
  }

  const missingInPdf = [...excelKeys].filter(k => !pdfKeys.has(k));
  const onlyInPdf    = [...pdfKeys].filter(k => !excelKeys.has(k));
  const matchCount   = excelKeys.size - missingInPdf.length;
  const diffCount    = missingInPdf.length + onlyInPdf.length;

  return {
    excelCount: excelKeys.size,
    pdfCount:   pdfKeys.size,
    matchCount,
    diffCount,
    missingInPdf: missingInPdf.map(_fmtKey),
    onlyInPdf:    onlyInPdf.map(_fmtKey),
    status: diffCount === 0 ? 'ok' : 'warn'
  };
}
