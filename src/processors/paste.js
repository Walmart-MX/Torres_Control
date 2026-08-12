/**
 * processors/paste.js
 * Parseo del texto pegado desde Excel en el panel "Datos de despacho".
 *
 * Detecta automáticamente la columna RUTA y las columnas opcionales
 * (hora de despacho, salida de caseta, usuario WTMS, ID master) usando
 * los alias regex definidos en DESP_ALIASES.
 *
 * Dependencias:
 *   - DESP_ALIASES (core/constants.js) — regex de detección de columnas
 *   - normDateTime (utils/date.js) — normaliza fecha/hora de cada celda
 */
import { DESP_ALIASES } from '../core/constants.js';
import { normDateTime } from '../utils/date.js';

/**
 * Parsea texto tabulado (pegado desde Excel) en datos de despacho por ruta.
 * Soporta separador tab, punto y coma, o coma — detectado automáticamente
 * a partir de la primera línea (encabezados).
 *
 * @param {string} raw — texto crudo pegado en el textarea
 * @returns {{ data: Map<string, object>, preview: Array<object>, idx: object }}
 * @throws {Error} si no hay al menos encabezado + 1 fila, o si no se
 *                  detecta una columna RUTA
 */
export function processPaste(raw) {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('Se necesita encabezado + datos');

  const sep     = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map(h => h.trim());
  const idx     = {};

  headers.forEach((h, i) => {
    for (const [field, re] of Object.entries(DESP_ALIASES)) {
      if (re.test(h) && idx[field] === undefined) idx[field] = i;
    }
  });

  if (idx.ruta === undefined) throw new Error('No se detectó columna RUTA');

  const result  = new Map();
  const preview = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim());
    const ruta = cols[idx.ruta] || '';
    if (!ruta) continue;
    const row = {
      hrDesp: idx.hrDesp !== undefined ? normDateTime(cols[idx.hrDesp] || '') : '',
      caseta: idx.caseta !== undefined ? normDateTime(cols[idx.caseta] || '') : '',
      wtms:   idx.wtms   !== undefined ? (cols[idx.wtms] || '')               : '',
      idIda:  idx.idIda  !== undefined ? (cols[idx.idIda] || '')              : ''
    };
    result.set(ruta, row);
    if (preview.length < 5) preview.push({ ruta, ...row });
  }

  return { data: result, preview, idx };
}
