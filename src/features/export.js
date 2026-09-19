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
const RIGHT_COLS  = new Set(['TARIMAS','CAJAS','CORTINA']);
const CENTER_COLS = new Set([...DATE_COLS, ...DATETIME_COLS, ...TIME_OUTPUT_COLS, 'DIA','SW','DET']);

// Anchos: autoajuste por contenido, con límites. Override manual por columna si hace falta.
const WIDTH_MIN = 6, WIDTH_MAX = 45, HEADER_PAD = 4, CELL_PAD = 2;
const WIDTH_OVERRIDES = { /* 'OPERADOR': 34 */ };

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

  const wsData = [BASE_ORDER, ...dataRows];
  const ws     = XLSX.utils.aoa_to_sheet(wsData, { cellDates: true });
  const range  = XLSX.utils.decode_range(ws['!ref']);

  const border = { style: 'thin', color: { rgb: THEME.border } };
  const baseFont = { name: THEME.font, sz: THEME.size };

  for (let C = 0; C < BASE_ORDER.length; C++) {
    const col = BASE_ORDER[C];

    // ── Encabezado ──
    const ha = XLSX.utils.encode_cell({ r: 0, c: C });
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

    // ── Datos ──
    const hAlign = RIGHT_COLS.has(col) ? 'right' : CENTER_COLS.has(col) ? 'center' : 'left';
    const isKey  = KEY_COLS.has(col);
    const isData = DATA_COLS.has(col);

    for (let R = 1; R <= range.e.r; R++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      // Celda vacía: se crea para que el zebra y los bordes no tengan huecos.
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };

      if (DATETIME_COLS.has(col))      ws[addr].z = 'DD/MM/YYYY HH:MM';
      else if (INT_COLS.has(col))      ws[addr].z = ws[addr].t === 'n' ? '0' : '@';
      else if (col === 'LIC.')         ws[addr].z = '@';   // licencia = texto, Excel no debe reinterpretarla

      const even = R % 2 === 0;
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
        const mergedRow     = dataSource[R - 1];
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

  ws['!freeze']     = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  ws['!autofilter'] = { ref: ws['!ref'] };
  ws['!rows']       = [{ hpt: 20 }, ...Array(range.e.r).fill({ hpt: 15 })];

  XLSX.utils.book_append_sheet(wb, ws, 'RUTEO UNIFICADO');
  // sessionDate si se pasó (redescarga de un día pasado); si no, hoy.
  const fecha = sessionDate || new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `ruteo_base_${fecha}.xlsx`, { cellStyles: true });
}
