/**
 * features/export.js
 * Genera y descarga el archivo Excel del despacho.
 *
 * CAMBIO Camino B / Fase 3: se reestructura en un registro de FORMATOS
 * (EXPORT_FORMATS) para preparar la arquitectura de múltiples exportadores
 * (hoy solo "Despacho"; "Monitoreo" se agregará después). Cada formato
 * define sus propias columnas, colores y anchos — la lógica de
 * construcción del workbook (buildWorkbook) es genérica y no cambia
 * cuando se agregue un nuevo formato, solo se agrega una nueva entrada
 * al registro.
 *
 * CAMBIO DE INTERFAZ: exportXLSX(rows, formatId, dateLabel) — los tres
 * parámetros son opcionales. exportXLSX() sin argumentos se comporta
 * EXACTAMENTE igual que antes (usa State.merged, formato 'despacho',
 * fecha de hoy) — cero cambio de comportamiento para los callers que
 * no necesitan lo nuevo. Los parámetros existen para reutilizar esta
 * misma función al re-descargar una sesión histórica (dispatch-history.js
 * vía Events.redownloadHistorySession/redownloadToday) sin duplicar la
 * lógica de construcción del Excel.
 *
 * No muta State. No toca el DOM directamente (XLSX.writeFile dispara
 * la descarga del navegador, pero eso no es manipulación del DOM de la app).
 *
 * Dependencias:
 *   - State (core/state.js) — leído solo como default de `rows`
 *   - BASE_ORDER, INT_COLS, DATE_COLS, DATETIME_COLS, RAW_TEXT_DATE_COLS,
 *     COLS_PDF, COLS_DESP, COLS_FILL, getMapped (core/constants.js)
 *   - parseDateTime (utils/date.js)
 *   - XLSX (SheetJS, global del CDN en index.html)
 */
import { State } from '../core/state.js';
import {
  BASE_ORDER, INT_COLS, DATE_COLS, DATETIME_COLS,
  COLS_PDF, COLS_DESP, COLS_FILL, getMapped
} from '../core/constants.js';
import { parseDateTime, resolveExcelDate } from '../utils/date.js';

const HDR_COLORS = { PDF:'005F4B', DESP:'3B2278', FILL:'7A3B00', DEFAULT:'1A2A4A' };

const COL_WIDTHS_DESPACHO = {
  'FECHA':13,'DIA':10,'SW':5,'LINEA':12,'ENTREGA':8,'ENT1':6,'RUTA':7,
  'ID IDA':11,'COSTOS IDA':11,'STATUS IDA':13,'ID RETORNO':11,'COSTO RETORNO':13,
  'STATUS RETORNO':14,'CARTA PORTE':11,'CAPTURA':9,'USUARIO WTMS':24,'LIC.':13,
  'OPERADOR':30,'DET':7,'FORMATO':8,'NOMBRE':28,'ESTADO':7,'TARIMAS':8,
  'MARCHAMO 1':11,'MARCHAMO 2':11,'MARCHAMO 3 ':11,'MARCHAMO 4':11,'MARCHAMO 5':11,
  'CAJAS':7,'CAP.':7,'CORTINA':8,'TRACTOR ':9,'PLACA TRACTOR':13,'REMOLQUE':9,
  'PLACA REMOLQUE':13,'GLS DE EMB.':11,'FAC.':13,'ESQUEMA':10,'TEMP. ENRAMPE':13,
  'TEMP. DESENRAMPE':15,'SOLICITUD DE ENRAMPE':20,'ENRAMPE':18,'TIEMPO ENRAMPE':14,
  'RETIRO':18,'TIEMP APROX DE CARGA':18,'RETIRO VS DESPACHO':18,'HORA DE FACTURACION':20,
  'HR. DESPACHO':18,'SALIDA DE CASETA ':18,'TIEMPO DE DESP':14,'TIEMPO EN PATIO':14,'CITA':18
};

/**
 * Registro de formatos de exportación. Cada entrada define:
 *   columns       — orden y conjunto de columnas del Excel
 *   colorOf(col)  — a qué grupo semántico pertenece la columna (para el
 *                   color de encabezado y el tinte de celda)
 *   colWidths     — anchos de columna
 *   sheetName     — nombre de la pestaña dentro del .xlsx
 *   filenamePrefix— prefijo del archivo descargado
 *
 * Para agregar "Monitoreo" en una fase futura: una nueva entrada aquí
 * con su propio columns/colorOf/colWidths — buildWorkbook() no cambia.
 */
export const EXPORT_FORMATS = {
  despacho: {
    id: 'despacho',
    label: 'Despacho',
    columns: BASE_ORDER,
    colorOf: col => COLS_PDF.has(col) ? 'PDF' : COLS_DESP.has(col) ? 'DESP' : COLS_FILL.has(col) ? 'FILL' : 'DEFAULT',
    colWidths: COL_WIDTHS_DESPACHO,
    sheetName: 'RUTEO UNIFICADO',
    filenamePrefix: 'ruteo_base'
  }
};

/**
 * Construye el workbook XLSX para un formato dado — lógica genérica,
 * compartida por todos los formatos del registro.
 * @private
 */
function buildWorkbook(rows, format) {
  const wb       = XLSX.utils.book_new();
  const dataRows = rows.map(row => format.columns.map(col => {
    let val = getMapped(row, col);
    if (val === '' || val === null || val === undefined) return '';

    // FIX (fidelidad de fecha/hora — julio 2026): estas columnas vienen
    // directo de RUTEO NUEVO y deben preservarse como texto literal —
    // ver nota de cabecera de processors/excel.js. Se resuelve ANTES que
    // DATE_COLS/DATETIME_COLS a propósito: aunque FECHA/ENRAMPE/RETIRO/
    // etc. también pertenecen a esos otros conjuntos, esta rama gana
    // siempre que el valor ya sea texto, evitando por completo la
    // reconstrucción de Date (y con ella, cualquier desfase de zona
    // horaria). El caso Date solo puede darse con sesiones históricas
    // guardadas antes de este fix (dispatch-history) — se conserva ahí
    // el comportamiento anterior únicamente para esos datos viejos.
    if (RAW_TEXT_DATE_COLS.has(col)) {
      if (typeof val === 'string') return val;
      if (val instanceof Date && !isNaN(val.getTime())) {
        return DATE_COLS.has(col)
          ? new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate()))
          : new Date(Date.UTC(val.getFullYear(), val.getMonth(), val.getDate(),
                               val.getHours(), val.getMinutes(), val.getSeconds() || 0));
      }
      return val;
    }

  if (DATE_COLS.has(col)) {
      // FIX: antes se usaba `val instanceof Date ? val : new Date(val)`,
      // que para celdas de texto (ej. "02/07/2026") delegaba en el
      // parser nativo MM/DD/YYYY y podía exportar el día/mes
      // invertidos. resolveExcelDate() (utils/date.js) es ahora la
      // única fuente de verdad para esta conversión — mismo resolver
      // que usa merge.js para SW/DIA, evita una segunda
      // implementación del mismo parseo.
      const d = resolveExcelDate(val);
      // Se conserva la reconstrucción vía Date.UTC() — necesaria
      // porque SheetJS serializa fechas ancladas en UTC (ver nota
      // original de este bloque).
      return d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : val;
    }

    if (DATETIME_COLS.has(col)) {
      if (val instanceof Date && !isNaN(val.getTime())) return val;
      const d = parseDateTime(String(val));
      return d ? d : val;
    }

    if (INT_COLS.has(col)) {
      // FIX (auditoría post-Camino B / #6 rutas partidas): RUTA puede
      // contener valores no puramente numéricos ("4102-2"). Antes se le
      // quitaban los caracteres no numéricos antes de convertir a
      // entero, perdiendo el guion ("4102-2" → 41022). Se preserva tal
      // cual cuando no es puramente dígitos — el resto de columnas de
      // INT_COLS (TARIMAS, CAJAS, marchamos, etc.) no cambia su
      // comportamiento.
      if (col === 'RUTA' && !/^\d+$/.test(String(val).trim())) return val;
      const n = parseInt(String(val).replace(/[^\d]/g,''), 10);
      return isNaN(n) ? val : n;
    }

    return val;
  }));

  const wsData = [format.columns, ...dataRows];
  const ws     = XLSX.utils.aoa_to_sheet(wsData, { cellDates: true });
  const range  = XLSX.utils.decode_range(ws['!ref']);

  for (let C = 0; C < format.columns.length; C++) {
    const col   = format.columns[C];
    const group = format.colorOf(col);
    const ha    = XLSX.utils.encode_cell({ r: 0, c: C });
    if (ws[ha]) {
      ws[ha].s = {
        font:      { bold: true, color: { rgb: 'FFFFFF' }, name: 'Calibri', sz: 9 },
        fill:      { patternType: 'solid', fgColor: { rgb: HDR_COLORS[group] || HDR_COLORS.DEFAULT } },
        alignment: { horizontal: 'center', vertical: 'center' }
      };
    }
    for (let R = 1; R <= range.e.r; R++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) continue;
      if (DATE_COLS.has(col))          ws[addr].z = 'DD/MM/YYYY';
      else if (DATETIME_COLS.has(col)) ws[addr].z = 'DD/MM/YYYY HH:MM';
      else if (INT_COLS.has(col))      ws[addr].z = '0';
      const even = R % 2 === 0;
      let bgRgb = even ? 'EEF4FF' : 'FFFFFF', fontRgb = '1A1A2E';
      const v = ws[addr].v;
      if (group === 'PDF'  && v !== undefined && v !== '') { bgRgb = 'E6FFF8'; fontRgb = '005040'; }
      else if (group === 'DESP' && v !== undefined && v !== '') { bgRgb = 'F0EBFF'; fontRgb = '3B1A8A'; }
      else if (group === 'FILL' && v !== undefined && v !== '') { bgRgb = 'FFF3E0'; fontRgb = '7A3B00'; }
      else if (col === 'RUTA') { bgRgb = even ? 'FFF8DC' : 'FFFFF0'; fontRgb = '7A3B00'; }
      ws[addr].s = {
        font:  { color: { rgb: fontRgb }, name: 'Calibri', sz: 9 },
        fill:  { patternType: 'solid', fgColor: { rgb: bgRgb } },
        alignment: { vertical: 'center' },
        border: { bottom: { style: 'thin', color: { rgb: 'CCCCCC' } }, right: { style: 'thin', color: { rgb: 'CCCCCC' } } }
      };
    }
  }

  ws['!cols']   = format.columns.map(c => ({ wch: format.colWidths[c] || 12 }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
  ws['!rows']   = [{ hpt: 18 }, ...Array(range.e.r).fill({ hpt: 14 })];

  XLSX.utils.book_append_sheet(wb, ws, format.sheetName);
  return wb;
}

/**
 * Genera y descarga el Excel de un procesamiento.
 *
 * @param {Array<object>} [rows=State.merged] — dataset a exportar. Se
 *    permite pasar un array arbitrario (ej. filas reconstruidas de una
 *    sesión histórica) para reutilizar esta misma función al re-descargar
 *    desde el Historial de Procesamientos.
 * @param {string} [formatId='despacho'] — clave en EXPORT_FORMATS
 * @param {string} [dateLabel] — fecha a usar en el nombre del archivo;
 *    por defecto la fecha de hoy. Al re-descargar una sesión histórica,
 *    pásale session.session_date para que el archivo refleje esa fecha
 *    y no la de hoy.
 */
export function exportXLSX(rows = State.merged, formatId = 'despacho', dateLabel = null) {
  const format = EXPORT_FORMATS[formatId];
  if (!format) { console.error('[Export] Formato de exportación desconocido:', formatId); return; }

  const wb    = buildWorkbook(rows, format);
  const fecha = dateLabel || new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${format.filenamePrefix}_${fecha}.xlsx`, { cellStyles: true });
}
