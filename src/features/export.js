/**
 * features/export.js
 * Genera y descarga el archivo Excel final del despacho (RUTEO UNIFICADO).
 *
 * Lee State.merged, aplica formatos de celda por tipo de columna y llama
 * XLSX.writeFile() para la descarga en el navegador.
 *
 * No muta State. No toca el DOM directamente.
 *
 * CAMBIO (sep-2026 — formato visual alineado a la vista previa):
 *   El Excel ahora replica el lenguaje visual de la vista previa del
 *   Historial (ui.js → .data-table): encabezado navy, texto monoespaciado
 *   (Consolas), filas alternadas, color SOLO en el texto de RUTA
 *   (ámbar) y de las columnas de datos de PDF (verde). Se retira el
 *   teñido de fondo por origen (PDF/DESP/FILL) que tenía la versión
 *   anterior — la vista previa no lo usa.
 *   Todo el estilo vive en THEME/KEY_COLS/DATA_COLS (abajo): ajustar la
 *   apariencia es cambiar esas constantes, no la lógica.
 *   Además: autofiltro, freeze de encabezado, anchos autoajustables y
 *   marchamos con cero inicial conservados como texto.
 *   NO cambia: columnas, orden, valores, ni la lógica de datos.
 *
 * AJUSTES previos que se conservan (jul-2026):
 *   1) FECHA se escribe como TEXTO "DD/MM/YYYY", sin objeto Date
 *      (ver _buildFechaTexto) — evita desfases de zona horaria.
 *   2) ID IDA / ID RETORNO / CARTA PORTE — parte de INT_COLS, número real.
 *   3) Columnas de tiempo con datos faltantes — resaltado ámbar.
 *
 * CAMBIO (oct-2026 — banner de secciones): se agrega una fila 0 fusionada
 * arriba del encabezado real (que pasa de fila 0 a fila 1 — TODO el resto
 * del archivo se recorre +1 fila) con el nombre de cada sección visual
 * (ver SECTION_BANNERS). Hoy solo existe la sección "FACTURACIÓN"
 * (FAC./MONTO FACTURA/GLS DE EMB., ver BASE_ORDER en core/constants.js) —
 * agregar otra sección es agregar una entrada a SECTION_BANNERS, siempre
 * que sus columnas sean CONTIGUAS en BASE_ORDER (_sectionRanges() ignora
 * silenciosamente cualquier sección que no lo sea, nunca rompe el export).
 *
 * Dependencias:
 *   - State (core/state.js) — lee State.merged únicamente
 *   - BASE_ORDER, INT_COLS, DATE_COLS, DATETIME_COLS, getMapped (core/constants.js)
 *   - TIME_RULES (core/time-engine.js)
 *   - parseDateTime (utils/date.js)
 *   - XLSX (SheetJS, global del CDN en index.html)
 */
import { State } from '../core/state.js';
import {
  BASE_ORDER, INT_COLS, DATE_COLS, DATETIME_COLS, getMapped
} from '../core/constants.js';
import { parseDateTime } from '../utils/date.js';
import { TIME_RULES } from '../core/time-engine.js';

// Columnas de salida del motor de tiempos — únicas donde aplica el
// resaltado de "dato faltante".
const TIME_OUTPUT_COLS = new Set(TIME_RULES.map(r => r.out));

// ── Tema visual — tokens tomados de la vista previa (index.html) ──
const THEME = {
  font: 'Consolas', size: 9,
  headerBg: '0B1D33',            // --navy
  headerText: 'E6ECF5',
  headerKey: 'F5A623',           // th.h-key (RUTA)
  headerData: '6EE7B7',          // th.h-pdf
  bodyBg: 'FFFFFF',
  zebraBg: 'F1F5FB',             // gris azulado tenue (--surface-2, apenas reforzado para Excel)
  text: '0B1526',                // --text
  textKey: 'C97C0E',             // .c-key (RUTA)
  textData: '1E9E6B',            // .c-pdf
  border: 'DDE3EC',
  missingBg: 'FDE68A', missingText: '92400E'   // resaltado de dato faltante (sin cambios)
};

// Columnas con color de énfasis — según lo pedido. FAC./CITA quedan neutras;
// para pintarlas de verde como en la vista previa, agrégalas a DATA_COLS.
const KEY_COLS  = new Set(['RUTA']);
const MARCHAMO_COLS = new Set(['MARCHAMO 1','MARCHAMO 2','MARCHAMO 3 ','MARCHAMO 4','MARCHAMO 5']);
const DATA_COLS = new Set(['OPERADOR','LIC.','TARIMAS', ...MARCHAMO_COLS]);

// Alineación: cantidades a la derecha; fechas/horas/tiempos y códigos cortos centrados; resto izquierda.
const RIGHT_COLS  = new Set(['TARIMAS','CAJAS','CORTINA','MONTO FACTURA']);
const CENTER_COLS = new Set([...DATE_COLS, ...DATETIME_COLS, ...TIME_OUTPUT_COLS, 'DIA','SW','DET']);

// Anchos: autoajuste por contenido, con límites. Override manual por columna si hace falta.
const WIDTH_MIN = 6, WIDTH_MAX = 45, HEADER_PAD = 4, CELL_PAD = 2;
const WIDTH_OVERRIDES = { /* 'OPERADOR': 34 */ };

// ── Banner de secciones (fila fusionada arriba del encabezado real) ──
// Cada entrada pinta un renglón con el label dado, fusionado de punta a
// punta sobre `cols`. `cols` DEBE ser un subconjunto contiguo de
// BASE_ORDER — ver _sectionRanges(), que valida esto y descarta en
// silencio cualquier sección mal formada en vez de romper el export.
const SECTION_BANNERS = [
  { label: 'FACTURACIÓN', cols: ['FAC.', 'MONTO FACTURA', 'GLS DE EMB.'] }
];

/**
 * Resuelve SECTION_BANNERS a rangos de columna [start, end] (índices en
 * BASE_ORDER), validando contigüidad. @private
 * @returns {Array<{label:string, start:number, end:number}>}
 */
function _sectionRanges() {
  const ranges = [];
  for (const section of SECTION_BANNERS) {
    const idxs = section.cols.map(c => BASE_ORDER.indexOf(c));
    if (idxs.some(i => i === -1)) continue; // columna renombrada/eliminada — se omite la sección
    const sorted = [...idxs].sort((a, b) => a - b);
    const isContiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (!isContiguous) continue;
    ranges.push({ label: section.label, start: sorted[0], end: sorted[sorted.length - 1] });
  }
  return ranges;
}

/**
 * Arma el array de la fila 0 (banner) — vacío salvo la celda inicial de
 * cada sección, que lleva el label (las demás celdas del rango se
 * fusionan sobre esa, ver '!merges' en exportXLSX()). @private
 * @param {Array<{label:string, start:number, end:number}>} sectionRanges
 * @returns {Array<string>}
 */
function _buildBannerRow(sectionRanges) {
  const row = BASE_ORDER.map(() => '');
  for (const s of sectionRanges) row[s.start] = s.label;
  return row;
}

/** Rellena con cero a la izquierda — "6" → "06". @private */
function _pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Construye el texto "DD/MM/YYYY" de la columna FECHA — SIN objeto Date
 * de por medio. Acepta {dd,mm,yyyy}, string, o Date (último respaldo).
 * @private
 */
function _buildFechaTexto(val) {
  if (val && typeof val === 'object' && !(val instanceof Date) && 'dd' in val) {
    return `${_pad2(val.dd)}/${_pad2(val.mm)}/${val.yyyy}`;
  }
  if (typeof val === 'string') return val;
  if (val instanceof Date && !isNaN(val.getTime())) {
    return `${_pad2(val.getDate())}/${_pad2(val.getMonth() + 1)}/${val.getFullYear()}`;
  }
  return String(val ?? '');
}

/** Largo visible aproximado de un valor de celda — para autoajustar anchos. @private */
function _displayLen(v) {
  if (v instanceof Date) return 16; // DD/MM/YYYY HH:MM
  return String(v ?? '').length;
}

/**
 * Construye el workbook Excel con una hoja "RUTEO UNIFICADO", aplica el
 * estilo (ver THEME), anchos, freeze, autofiltro y dispara la descarga
 * con nombre ruteo_base_YYYY-MM-DD.xlsx.
 */
export function exportXLSX(rows, exportType, sessionDate) {
  // Si se pasan filas explícitas (redescarga desde Historial), se usan
  // esas — nunca State.merged de la sesión actual.
  const dataSource = (rows && rows.length) ? rows : State.merged;

  const wb       = XLSX.utils.book_new();
  const dataRows = dataSource.map(row => BASE_ORDER.map(col => {
    let val = getMapped(row, col);
    if (val === '' || val === null || val === undefined) return '';
    if (DATE_COLS.has(col)) {
      return _buildFechaTexto(val);
    }
    if (DATETIME_COLS.has(col)) {
      if (val instanceof Date && !isNaN(val.getTime())) return val;
      const d = parseDateTime(String(val));
      return d ? d : val;
    }
    if (INT_COLS.has(col)) {
      const s = String(val).trim();
      // Un marchamo con cero inicial ("012345") se conserva como TEXTO —
      // parseInt lo convertiría en 12345 y perdería el cero.
      if (MARCHAMO_COLS.has(col) && /^0\d+$/.test(s)) return s;
      const n = parseInt(s.replace(/[^\d]/g,''), 10);
      return isNaN(n) ? val : n;
    }
    return val;
  }));

  const sectionRanges = _sectionRanges();
  const wsData = [_buildBannerRow(sectionRanges), BASE_ORDER, ...dataRows];
  const ws     = XLSX.utils.aoa_to_sheet(wsData, { cellDates: true });
  const range  = XLSX.utils.decode_range(ws['!ref']);

  const border = { style: 'thin', color: { rgb: THEME.border } };
  const baseFont = { name: THEME.font, sz: THEME.size };

  // ── Banner de secciones (fila 0) ──
  ws['!merges'] = sectionRanges
    .filter(s => s.end > s.start)
    .map(s => ({ s: { r: 0, c: s.start }, e: { r: 0, c: s.end } }));
  for (const s of sectionRanges) {
    for (let c = s.start; c <= s.end; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = {
        font:      { ...baseFont, bold: true, sz: THEME.size + 1, color: { rgb: THEME.headerBg } },
        fill:      { patternType: 'solid', fgColor: { rgb: THEME.headerKey } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border:    { top: border, bottom: border, left: border, right: border }
      };
    }
  }

  for (let C = 0; C < BASE_ORDER.length; C++) {
    const col = BASE_ORDER[C];

    // ── Encabezado (fila 1 — la fila 0 es el banner de secciones) ──
    const ha = XLSX.utils.encode_cell({ r: 1, c: C });
    if (ws[ha]) {
      const headerColor = KEY_COLS.has(col)  ? THEME.headerKey
                        : DATA_COLS.has(col) ? THEME.headerData
                        : THEME.headerText;
      ws[ha].s = {
        font:      { ...baseFont, bold: true, color: { rgb: headerColor } },
        fill:      { patternType: 'solid', fgColor: { rgb: THEME.headerBg } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border:    { bottom: border, right: { style: 'thin', color: { rgb: '1B3A63' } } }
      };
    }

    // ── Datos (desde fila 2) ──
    const hAlign = RIGHT_COLS.has(col) ? 'right' : CENTER_COLS.has(col) ? 'center' : 'left';
    const isKey  = KEY_COLS.has(col);
    const isData = DATA_COLS.has(col);

    for (let R = 2; R <= range.e.r; R++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      // Celda vacía: se crea para que el zebra y los bordes no tengan huecos.
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };

      if (DATETIME_COLS.has(col))      ws[addr].z = 'DD/MM/YYYY HH:MM';
      else if (INT_COLS.has(col))      ws[addr].z = ws[addr].t === 'n' ? '0' : '@';
      else if (col === 'LIC.')         ws[addr].z = '@';   // licencia = texto, Excel no debe reinterpretarla

      const dataIdx = R - 2; // fila 0 = banner, fila 1 = encabezado, fila 2 = primer dato
      const even = dataIdx % 2 === 1;
      ws[addr].s = {
        font: {
          ...baseFont,
          bold: isKey,
          color: { rgb: isKey ? THEME.textKey : isData ? THEME.textData : THEME.text }
        },
        fill:      { patternType: 'solid', fgColor: { rgb: even ? THEME.zebraBg : THEME.bodyBg } },
        alignment: { horizontal: hAlign, vertical: 'center' },
        border:    { bottom: border, right: border }
      };

      if (TIME_OUTPUT_COLS.has(col)) {
        // dataSource (no State.merged): al redescargar desde Historial
        // puede ser otro array.
        const mergedRow     = dataSource[dataIdx];
        const missingReason = mergedRow && mergedRow._timeMissing && mergedRow._timeMissing[col];
        if (missingReason) {
          ws[addr].s.fill = { patternType: 'solid', fgColor: { rgb: THEME.missingBg } };
          ws[addr].s.font = { ...ws[addr].s.font, color: { rgb: THEME.missingText }, bold: true };
        }
      }
    }
  }

  // ── Anchos autoajustados ──
  ws['!cols'] = BASE_ORDER.map((col, c) => {
    if (WIDTH_OVERRIDES[col]) return { wch: WIDTH_OVERRIDES[col] };
    let max = String(col).trim().length + HEADER_PAD; // margen para el botón del filtro
    for (const r of dataRows) max = Math.max(max, _displayLen(r[c]) + CELL_PAD);
    return { wch: Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, max)) };
  });

  ws['!freeze']     = { xSplit: 0, ySplit: 2, topLeftCell: 'A3', activePane: 'bottomLeft', state: 'frozen' };
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: range.e.r, c: range.e.c } }) };
  ws['!rows']       = [{ hpt: 22 }, { hpt: 20 }, ...Array(Math.max(0, range.e.r - 1)).fill({ hpt: 15 })];

  XLSX.utils.book_append_sheet(wb, ws, 'RUTEO UNIFICADO');
  // sessionDate si se pasó (redescarga de un día pasado); si no, hoy.
  const fecha = sessionDate || new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `ruteo_base_${fecha}.xlsx`, { cellStyles: true });
}
