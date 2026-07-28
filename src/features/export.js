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
 *   1) FECHA — SEGUNDO INTENTO. El primer intento seguía manipulando
 *      un objeto Date (redondeo + lectura en UTC), pero ese objeto ya
 *      viene ambiguo desde que SheetJS lo construye a partir del
 *      serial de Excel — cualquier operación sobre él hereda esa
 *      ambigüedad. Ahora getMapped(row,'FECHA') devuelve directamente
 *      el TEXTO que Excel mostraba en la celda original de RUTEO NUEVO
 *      (ver processors/excel.js → row._FECHA_TEXT, leído de `.w` de la
 *      celda cruda, nunca de un Date). Aquí solo se separan los tres
 *      números de ese texto (día/mes/año) y se arma un Date local con
 *      esos mismos números — cero cálculo, cero zona horaria. El
 *      formato de celda sigue siendo 'DD/MM/YYYY' (sin hora).
 *   2) ID IDA / ID RETORNO / CARTA PORTE — ahora forman parte de
 *      INT_COLS (core/constants.js). Este archivo YA convertía a
 *      número real cualquier columna de INT_COLS y le aplicaba formato
 *      '0' — no requirió ningún cambio de código aquí, solo la entrada
 *      de configuración en constants.js.
 *   3) Columnas de tiempo con datos faltantes — cuando
 *      core/time-engine.js no pudo calcular un tiempo porque faltó
 *      alguno de sus dos datos de entrada, deja constancia en
 *      row._timeMissing[col] (ver time-engine.js). Aquí se usa esa
 *      información SOLO en el archivo final: la celda vacía se resalta
 *      con relleno ámbar. NO se agrega comentario de Excel — se
 *      retiró por estética (feedback jul-2026): solo el resaltado
 *      visual, sin texto emergente.
 *
 * Dependencias:
 *   - State (core/state.js) — lee State.merged únicamente
 *   - BASE_ORDER, INT_COLS, DATE_COLS, DATETIME_COLS,
 *     COLS_PDF, COLS_DESP, COLS_FILL, getMapped (core/constants.js)
 *   - TIME_RULES (core/time-engine.js) — nombres de columna cuyo valor
 *     puede venir acompañado de row._timeMissing[col]
 *   - parseDateTime (utils/date.js) — convierte strings de fecha a Date
 *     para que SheetJS aplique el formato correcto
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

/**
 * Parsea el texto EXACTO de la celda FECHA (ej. "27/07/2026",
 * "27-07-2026", "27.07.2026") en {dd, mm, yyyy} — pura extracción de
 * dígitos en el orden DD/MM/YYYY, sin ningún cálculo ni interpretación
 * de zona horaria. Devuelve null si el texto no trae un patrón
 * reconocible (en cuyo caso el valor original se deja tal cual, sin
 * inventar nada).
 * @private
 * @param {string} text
 * @returns {{dd:number, mm:number, yyyy:number}|null}
 */
function _parseFechaTexto(text) {
  const m = String(text).trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  let yyyy = parseInt(m[3], 10);
  if (yyyy < 100) yyyy += 2000;
  return { dd, mm, yyyy };
}

/**
 * Construye el workbook Excel con una hoja "RUTEO UNIFICADO",
 * aplica estilos de encabezado y celda, anchos de columna, freeze
 * de primera fila, y dispara la descarga con nombre ruteo_base_YYYY-MM-DD.xlsx.
 */
export function exportXLSX() {
  const wb       = XLSX.utils.book_new();
  const dataRows = State.merged.map(row => BASE_ORDER.map(col => {
    let val = getMapped(row, col);
    if (val === '' || val === null || val === undefined) return '';
    if (DATE_COLS.has(col)) {
      // AJUSTE (jul-2026 — FECHA, segundo intento): val ya es el texto
      // exacto de la celda original (ver processors/excel.js →
      // row._FECHA_TEXT, vía COL_MAP['FECHA'] en constants.js). Se
      // extraen sus tres números tal cual y se arma un Date local con
      // ellos — ningún cálculo, ninguna conversión de zona horaria.
      if (typeof val === 'string') {
        const parsed = _parseFechaTexto(val);
        if (parsed) return new Date(parsed.yyyy, parsed.mm - 1, parsed.dd);
        return val; // texto no reconocido — se deja tal cual, sin inventar nada
      }
      // Respaldo — solo se usa si por algún motivo no se detectó la
      // columna FECHA al leer el Excel (ver excel.js) y COL_MAP cayó a
      // r['FECHA'], que en ese caso sigue siendo el Date de SheetJS.
      const d = val instanceof Date ? val : new Date(val);
      return isNaN(d.getTime()) ? val : new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
      if (DATE_COLS.has(col))          ws[addr].z = 'DD/MM/YYYY';
      else if (DATETIME_COLS.has(col)) ws[addr].z = 'DD/MM/YYYY HH:MM';
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

      // AJUSTE (jul-2026 — identificación de datos faltantes para el
      // cálculo de tiempos): SOLO en el archivo final. Si esta celda es
      // la salida de una regla de core/time-engine.js y el cálculo no
      // se pudo hacer por falta de dato de entrada, se resalta con
      // relleno ámbar — SIN comentario de Excel (se retiró por
      // estética, feedback jul-2026). El detalle de qué faltó
      // (row._timeMissing[col]) sigue calculándose en time-engine.js
      // por si se necesita en otro lugar más adelante, pero aquí ya
      // no se muestra como comentario, solo como resaltado visual.
      if (TIME_OUTPUT_COLS.has(col)) {
        const mergedRow     = State.merged[R - 1];
        const missingReason = mergedRow && mergedRow._timeMissing && mergedRow._timeMissing[col];
        if (missingReason) {
          ws[addr].s.fill = { patternType: 'solid', fgColor: { rgb: 'FDE68A' } };
          ws[addr].s.font = { ...ws[addr].s.font, color: { rgb: '92400E' }, bold: true };
        }
      }
    }
  }

  const W = {
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
  ws['!cols']  = BASE_ORDER.map(c => ({ wch: W[c] || 12 }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
  ws['!rows']  = [{ hpt: 18 }, ...Array(range.e.r).fill({ hpt: 14 })];

  XLSX.utils.book_append_sheet(wb, ws, 'RUTEO UNIFICADO');
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `ruteo_base_${fecha}.xlsx`, { cellStyles: true });
}
