/**
 * processors/paste.js
 * Parseo del texto pegado desde Excel en el panel "Status de despacho".
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   RUTA e ID'S MASTER pasan de opcionales a obligatorias. Dos
 *   validaciones nuevas lanzan Error si no se cumplen.
 */
import { DESP_ALIASES } from '../core/constants.js';
import { normDateTime } from '../utils/date.js';

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
  if (idx.idIda === undefined) {
    throw new Error("No se detectó columna ID'S MASTER — es obligatoria para relacionar con el Reporte WTMS");
  }

  const result  = new Map();
  const preview = [];
  let anyIdIda  = false;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(sep).map(c => c.trim());
    const ruta = cols[idx.ruta] || '';
    if (!ruta) continue;
    const idIda = cols[idx.idIda] || '';
    if (idIda) anyIdIda = true;
    const row = {
      hrDesp: idx.hrDesp !== undefined ? normDateTime(cols[idx.hrDesp] || '') : '',
      caseta: idx.caseta !== undefined ? normDateTime(cols[idx.caseta] || '') : '',
      wtms:   idx.wtms   !== undefined ? (cols[idx.wtms] || '')               : '',
      idIda
    };
    result.set(ruta, row);
    if (preview.length < 5) preview.push({ ruta, ...row });
  }

  if (!anyIdIda) {
    throw new Error("La columna ID'S MASTER está vacía en todas las filas — es obligatoria");
  }

  return { data: result, preview, idx };
}
