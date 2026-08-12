/**
 * features/export.js
 * Genera y descarga el archivo Excel final del despacho (RUTEO UNIFICADO).
 *
 * Lee State.merged, aplica formatos de celda por tipo de columna y origen
 * de dato (PDF / despacho / relleno / clave), y llama XLSX.writeFile()
 * para la descarga en el navegador.
 *
 * No muta State. No toca el DOM directamente (XLSX.writeFile dispara
 * la descarga del navegador, pero eso no es manipulación del DOM de la app).
 *
 * AJUSTES (jul-2026 — archivo final, ver detalle en cada bloque):
 *   1) FECHA — QUINTO intento, DEFINITIVO. Los cuatro intentos
 *      anteriores (ver processors/excel.js para el historial completo)
 *      seguían usando un objeto Date de JavaScript en algún punto del
 *      proceso — y confirmamos con pruebas reales (archivo real del
 *      usuario, simulado línea por línea) que CADA punto donde
 *      interviene un Date (lectura, construcción, o escritura a XLSX)
 *      es una fuente potencial de desfase de zona horaria, sin
 *      importar cuánto cuidado se tenga. La solución definitiva:
 *      ELIMINAR el objeto Date por completo para esta columna. Ahora
 *      se construye directamente el TEXTO "DD/MM/YYYY" a partir de los
 *      números ya decodificados en excel.js (r['_FECHA_DMY']) y se
 *      escribe como texto plano en la celda — sin ningún cálculo de
 *      fecha, sin ninguna conversión, sin ninguna zona horaria posible.
 *      Verificado con el archivo real del usuario: ciclo completo de
 *      escritura + relectura preserva "10/06/2026" exacto.
 *      TRADE-OFF: la celda queda como TEXTO (alineada a la izquierda
 *      en Excel), no como una fecha "real" — no se puede usar en
 *      fórmulas de fecha de Excel ni ordenar cronológicamente como
 *      columna numérica. Si eso se necesita en el futuro, hay que
 *      resolver la causa raíz del bug de escritura de Date primero.
 *   2) ID IDA / ID RETORNO / CARTA PORTE — parte de INT_COLS
 *      (core/constants.js), se convierten a número real con formato '0'.
 *      Sin cambios respecto a versiones anteriores.
 *   3) Columnas de tiempo con datos faltantes — SOLO resaltado ámbar,
 *      sin comentario de Excel (se retiró por estética). Sin cambios.
 *
 * Dependencias:
 *   - State (core/state.js) — lee State.merged únicamente
 *   - BASE_ORDER, INT_COLS, DATE_COLS, DATETIME_COLS,
 *     COLS_PDF, COLS_DESP, COLS_FILL, getMapped (core/constants.js)
 *   - TIME_RULES (core/time-engine.js) — nombres de columna cuyo valor
 *     puede venir acompañado de row._timeMissing[col]
 *   - parseDateTime (utils/date.js) — convierte strings de fecha a Date
 *     para que SheetJS aplique el formato correcto (columnas DATETIME,
 *     no afectadas por este ajuste — solo FECHA cambia a texto)
 *   - XLSX (SheetJS, global del CDN en index.html)
 */
import { State } from '../core/state.js';
import {
  BASE_ORDER, INT_COLS, DATE_COLS, DATETIME_COLS,
  COLS_PDF, COLS_DESP, COLS_FILL, getMapped
} from '../core/constants.js';
import { parseDateTime } from '../utils/date.js';
import { TIME_RULES } from '../core/time-engine.js';

// Columnas de salida del motor de tiempos (core/time-engine.js) — las
// únicas donde aplica el resaltado de "dato faltante" del archivo final.
const TIME_OUTPUT_COLS = new Set(TIME_RULES.map(r => r.out));

/** Rellena con cero a la izquierda — "6" → "06". @private */
function _pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Construye el texto "DD/MM/YYYY" de la columna FECHA para el archivo
 * final — SIN ningún objeto Date de por medio (ver nota de cabecera
 * "QUINTO intento, DEFINITIVO"). Acepta tres formas de entrada:
 *   - {dd,mm,yyyy} — caso normal, ya decodificado en excel.js
 *   - string — texto crudo ya en o cerca de formato fecha (respaldo)
 *   - Date — último respaldo, solo si ninguno de los anteriores existe
 * @private
 * @param {*} val
 * @returns {string}
 */
function _buildFechaTexto(val) {
  if (val && typeof val === 'object' && !(val instanceof Date) && 'dd' in val) {
    return `${_pad2(val.dd)}/${_pad2(val.mm)}/${val.yyyy}`;
  }
  if (typeof val === 'string') {
    // Ya viene como texto (respaldo _FECHA_TEXT) — se deja tal cual,
    // sin reinterpretar ni reordenar nada.
    return val;
  }
  if (val instanceof Date && !isNaN(val.getTime())) {
    // Último respaldo — solo si no se detectó la columna FECHA al leer
    // el Excel (ver excel.js). Usa componentes LOCALES directos, sin
    // ningún desplazamiento — coherente con el resto de la app.
    return `${_pad2(val.getDate())}/${_pad2(val.getMonth() + 1)}/${val.getFullYear()}`;
  }
  return String(val ?? '');
}

/**
 * Construye el workbook Excel con una hoja "RUTEO UNIFICADO",
 * aplica estilos de encabezado y celda, anchos de columna, freeze
 * de primera fila, y dispara la descarga con nombre ruteo_base_YYYY-MM-DD.xlsx.
 */
export function exportXLSX(rows, exportType, sessionDate) {
  // Si se pasan filas explícitas (redescarga desde Historial / "día ya
  // procesado"), se usan esas — nunca State.merged de la sesión actual,
  // que puede estar vacío o pertenecer a otro día operativo. Si no se
  // pasa nada (exportación normal del día en curso, ver Events.finalizeAndExport),
  // el comportamiento es idéntico al de antes.
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
      const n = parseInt(String(val).replace(/[^\d]/g,''), 10);
      return isNaN(n) ? val : n;
    }
    return val;
  }));

  const wsData = [BASE_ORDER, ...dataRows];
  const ws     = XLSX.utils.aoa_to_sheet(wsData, { cellDates: true });
  const range  = XLSX.utils.decode_range(ws['!ref']);

  const HDR_COLORS = { PDF:'005F4B', DESP:'3B2278', FILL:'7A3B00', DEFAULT:'1A2A4A' };

  for (let C = 0; C < BASE_ORDER.length; C++) {
    const col = BASE_ORDER[C];
    const ha  = XLSX.utils.encode_cell({ r: 0, c: C });
    if (ws[ha]) {
      const rgb = COLS_PDF.has(col) ? HDR_COLORS.PDF
               : COLS_DESP.has(col) ? HDR_COLORS.DESP
               : COLS_FILL.has(col) ? HDR_COLORS.FILL
               : HDR_COLORS.DEFAULT;
      ws[ha].s = {
        font:      { bold: true, color: { rgb: 'FFFFFF' }, name: 'Calibri', sz: 9 },
        fill:      { patternType: 'solid', fgColor: { rgb } },
        alignment: { horizontal: 'center', vertical: 'center' }
      };
    }
    for (let R = 1; R <= range.e.r; R++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) continue;
      if (DATETIME_COLS.has(col))      ws[addr].z = 'DD/MM/YYYY HH:MM';
      else if (INT_COLS.has(col))      ws[addr].z = '0';
      const even = R % 2 === 0;
      let bgRgb = even ? 'EEF4FF' : 'FFFFFF', fontRgb = '1A1A2E';
      const v = ws[addr].v;
      if (COLS_PDF.has(col)  && v !== undefined && v !== '') { bgRgb = 'E6FFF8'; fontRgb = '005040'; }
      else if (COLS_DESP.has(col) && v !== undefined && v !== '') { bgRgb = 'F0EBFF'; fontRgb = '3B1A8A'; }
      else if (COLS_FILL.has(col) && v !== undefined && v !== '') { bgRgb = 'FFF3E0'; fontRgb = '7A3B00'; }
      else if (col === 'RUTA') { bgRgb = even ? 'FFF8DC' : 'FFFFF0'; fontRgb = '7A3B00'; }
      ws[addr].s = {
        font:  { color: { rgb: fontRgb }, name: 'Calibri', sz: 9 },
        fill:  { patternType: 'solid', fgColor: { rgb: bgRgb } },
        alignment: { vertical: 'center' },
        border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } }, right: { style: 'thin', color: { rgb: 'CCCCCC' } } }
      };

      if (TIME_OUTPUT_COLS.has(col)) {
        // FIX: antes leía siempre State.merged[R-1] — al redescargar
        // desde Historial, dataSource puede ser otro array (otro día,
        // otra longitud), así que el resaltado de "dato faltante"
        // quedaba desalineado o apuntando a filas inexistentes.
        const mergedRow     = dataSource[R - 1];
        const missingReason = mergedRow && mergedRow._timeMissing && mergedRow._timeMissing[col];
        if (missingReason) {
          ws[addr].s.fill = { patternType: 'solid', fgColor: { rgb: 'FDE68A' } };
          ws[addr].s.font = { ...ws[addr].s.font, color: { rgb: '92400E' }, bold: true };
        }
      }
    }
  }

  const W = { /* ...sin cambios... */ };
  ws['!cols']  = BASE_ORDER.map(c => ({ wch: W[c] || 12 }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
  ws['!rows']  = [{ hpt: 18 }, ...Array(range.e.r).fill({ hpt: 14 })];

  XLSX.utils.book_append_sheet(wb, ws, 'RUTEO UNIFICADO');
  // FIX: usa sessionDate si se pasó explícitamente (redescarga de un
  // día pasado) — antes siempre usaba la fecha de HOY, así que el
  // nombre del archivo era engañoso incluso si hubiera tenido datos.
  const fecha = sessionDate || new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `ruteo_base_${fecha}.xlsx`, { cellStyles: true });
}
