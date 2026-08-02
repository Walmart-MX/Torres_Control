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
export function exportXLSX() {
  const wb       = XLSX.utils.book_new();
  const dataRows = State.merged.map(row => BASE_ORDER.map(col => {
    let val = getMapped(row, col);
    if (val === '' || val === null || val === undefined) return '';
    if (DATE_COLS.has(col)) {
      // AJUSTE (jul-2026, quinto intento): texto plano, sin Date — ver
      // nota de cabecera. _buildFechaTexto() nunca crea ni manipula un
      // objeto Date para esta columna.
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
      // FECHA ya no lleva formato numérico de fecha — es texto plano
      // (ver _buildFechaTexto), así que se omite intencionalmente de
      // este bloque. Aplicar 'DD/MM/YYYY' a una celda de texto no hace
      // daño (Excel lo ignora), pero se omite para que quede claro que
      // ya no es una celda de fecha "real".
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

      // AJUSTE (jul-2026 — identificación de datos faltantes para el
      // cálculo de tiempos): SOLO en el archivo final. Si esta celda es
      // la salida de una regla de core/time-engine.js y el cálculo no
      // se pudo hacer por falta de dato de entrada, se resalta con
      // relleno ámbar — SIN comentario de Excel.
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
