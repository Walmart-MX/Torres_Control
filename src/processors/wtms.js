/**
 * processors/wtms.js
 * Parseo del Reporte WTMS (CSV) — 4ª fuente obligatoria de SmartDispatch.
 *
 * CONTEXTO: a partir de esta integración, ninguna de las cuatro fuentes
 * (PDFs, Excel macro, Status de despacho, Reporte WTMS) es opcional —
 * ver Events.checkSources() en events/events.js, que bloquea el merge
 * completo si falta cualquiera.
 *
 * El WTMS se trata como CATÁLOGO TEMPORAL de la corrida actual — se
 * recarga en cada procesamiento, NO se persiste en Supabase (a
 * diferencia de operators/fact_cache/catálogos maestros de Camino B/C).
 * State.wtmsData se reinicia junto con pdfData/xlsData/despData en
 * UI.resetAll().
 *
 * Solo interesan tres columnas del archivo, todo lo demás se descarta:
 *   ID de la carga   → clave del índice (Map)
 *   Carte Porte      → mapea a CARTA PORTE del archivo final
 *   Siguiente Carga  → mapea a ID RETORNO del archivo final
 *
 * El cruce con el Status de despacho ocurre en processors/merge.js:
 *   Status.ID'S MASTER  ==  WTMS.ID de la carga
 *
 * FORMATO DEL CSV (confirmado con archivo de muestra real,
 * LoadPreview — jul-2026): separador coma, campos entre comillas
 * dobles, puede traer BOM UTF-8, encabezados con acentos ("creación",
 * "Vehículo", etc. — ninguna de las 3 columnas que usamos los lleva,
 * pero se normaliza con stripAccents() de todas formas por robustez
 * ante variantes de export). _parseCSV() implementa manejo real de
 * comillas (RFC4180) — NO es un split ingenuo por coma — porque un
 * valor de campo puede legítimamente contener una coma interna, que es
 * justo el caso de negocio de "doble dato" (ej. "1234,4321" en
 * Siguiente Carga) que se reporta como incidencia crítica en el SVE
 * (ver features/validation/sve.js, regla 'wtms_ambiguous').
 *
 * Dependencias:
 *   - stripAccents (utils/format.js) — tolerancia a acentos en encabezados
 */
import { stripAccents } from '../utils/format.js';

/** Alias regex para detectar columnas del Reporte WTMS, aplicados
 *  sobre el encabezado ya normalizado (stripAccents + trim). */
export const WTMS_ALIASES = {
  idCarga:        /^id\s*de\s*la\s*carga$/i,
  cartePorte:     /^carte\s*porte$/i,
  siguienteCarga: /^siguiente\s*carga$/i
};

/**
 * Parser CSV mínimo con manejo de comillas (RFC4180): soporta campos
 * entre comillas con comas y comillas escapadas ("") dentro, y ambos
 * finales de línea (\r\n y \n). No es un parser CSV completo (no
 * maneja campos multilínea más allá de \n dentro de comillas — no se
 * ha observado ese caso en los archivos de WTMS reales), pero cubre
 * el formato real verificado del Reporte WTMS.
 * @private
 * @param {string} raw
 * @returns {Array<Array<string>>}
 */
function _parseCSV(raw) {
  const s = String(raw || '').replace(/^\uFEFF/, ''); // strip BOM
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // ignorado — el salto real de línea lo maneja \n
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  // última línea sin salto final
  if (field.length || row.length) { row.push(field); rows.push(row); }

  // descarta líneas completamente vacías (ej. línea final en blanco)
  return rows.filter(r => r.some(c => String(c || '').trim() !== ''));
}

/**
 * Parsea el Reporte WTMS (texto crudo del CSV) en un índice Map
 * idCarga → { carteporte, siguienteCarga }.
 *
 * @param {string} raw — contenido crudo del archivo .csv
 * @returns {{ data: Map<string, {carteporte:string, siguienteCarga:string}>,
 *             preview: Array<object>, idx: object }}
 * @throws {Error} si no hay encabezado + datos, si no se detecta la
 *                  columna "ID de la carga", o si ninguna fila trae
 *                  un ID de carga no vacío
 */
export function processWTMS(raw) {
  const table = _parseCSV(raw);
  if (table.length < 2) throw new Error('El Reporte WTMS necesita encabezado + datos');

  const headers = table[0].map(h => stripAccents(h).trim());
  const idx = {};
  headers.forEach((h, i) => {
    for (const [field, re] of Object.entries(WTMS_ALIASES)) {
      if (re.test(h) && idx[field] === undefined) idx[field] = i;
    }
  });

  if (idx.idCarga === undefined) {
    throw new Error('No se detectó la columna "ID de la carga" en el Reporte WTMS');
  }

  const data = new Map();
  const preview = [];

  for (let i = 1; i < table.length; i++) {
    const cols = table[i];
    const idCarga = String(cols[idx.idCarga] || '').trim();
    if (!idCarga) continue;

    const entry = {
      carteporte:     idx.cartePorte      !== undefined ? String(cols[idx.cartePorte] || '').trim()      : '',
      siguienteCarga: idx.siguienteCarga  !== undefined ? String(cols[idx.siguienteCarga] || '').trim()  : ''
    };
    data.set(idCarga, entry);
    if (preview.length < 5) preview.push({ idCarga, ...entry });
  }

  if (!data.size) {
    throw new Error('El Reporte WTMS no contiene filas con "ID de la carga" válido');
  }

  return { data, preview, idx };
}
