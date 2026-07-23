/**
 * processors/excel.js
 * Lectura del Excel macro: hoja RUTEO NUEVO (rutas del día) y hoja
 * CONCENTRADO FACTURAS (datos de facturación) si existe.
 *
 * FIX (auditoría post-Camino B): _fixExcelDateRow() — SheetJS
 * (cellDates:true) construye los Date de celdas de fecha usando UTC
 * medianoche (Date.UTC(y,m,d)). El resto de la app lee esos objetos con
 * métodos LOCALES (getFullYear/getMonth/getDate, usados en
 * features/export.js al armar la columna FECHA). En una zona horaria con
 * offset negativo (México, UTC-6), el objeto "retrocede" al día
 * anterior — la columna FECHA salía con un día menos que el real. Se
 * reconstruye cada Date usando sus propios componentes UTC como si
 * fueran locales, así el resto de la app (que ya asume fechas locales)
 * los lee correctamente. Se aplica a ambas hojas por robustez — cualquier
 * columna de fecha en cualquiera de las dos sufre el mismo bug de SheetJS.
 *
 * FIX (fidelidad de fecha/hora — julio 2026, v2): para las columnas de
 * RUTEO NUEVO (FECHA, TEMP. ENRAMPE/DESENRAMPE, SOLICITUD DE ENRAMPE,
 * ENRAMPE, RETIRO) se abandonó por completo el objeto Date — ver
 * _serialToParts()/_fmtSerial() abajo. Se lee el número serial PURO de
 * la celda (segunda lectura del workbook con cellDates:false) y se
 * calculan los componentes de calendario con aritmética simple. Cero
 * Date, cero getters UTC/locales, cero ambigüedad de zona horaria.
 *
 * FIX (fidelidad de HORA DE FACTURACION — julio 2026, v3):
 *   La corrección v2 NO se había extendido a la hoja CONCENTRADO
 *   FACTURAS — esa columna seguía dependiendo de _fixExcelDateRow()
 *   (Date reconstruido) + formatFactDate() (lectura con getters
 *   locales), la misma cadena de conversiones Date que causaba el bug
 *   original en ENRAMPE/RETIRO antes de migrarlas a serial puro. El
 *   síntoma reportado (+6h exactas, el offset de México) es la firma
 *   típica de un Date leído con el getter que no corresponde en algún
 *   punto de esa cadena.
 *
 *   Causa raíz: cualquier ruta que pase por un objeto Date (aunque sea
 *   "corregido") sigue expuesta a este tipo de desfase. La única
 *   fuente sin ambigüedad es el número serial de Excel. Se aplica
 *   ahora la MISMA técnica que ya funciona para RUTEO NUEVO: leer el
 *   serial puro de la celda de fecha de facturación (misma lectura
 *   cellDates:false, extendida a la hoja de facturas) y formatearlo
 *   con _fmtSerial() — sin tocar formatFactDate()/Date en absoluto
 *   para el caso numérico. formatFactDate() se conserva como fallback
 *   únicamente para el caso (raro) de que la celda no sea numérica.
 *
 * Dependencias:
 *   - XLSX (SheetJS, cargado globalmente desde el CDN en index.html)
 *   - SHEET_RUTEO, SHEET_FACTURAS (core/constants.js) — nombres alternativos
 *     de hoja que se buscan por coincidencia parcial, insensible a mayúsculas
 *   - formatFactDate (utils/format.js) — fallback para celdas de fecha
 *     de facturación que no llegan como número serial (texto suelto)
 */
import { SHEET_RUTEO, SHEET_FACTURAS } from '../core/constants.js';
import { formatFactDate } from '../utils/format.js';

/**
 * Corrige el desfase de zona horaria de SheetJS: reconstruye cualquier
 * valor Date de la fila usando sus componentes UTC como si fueran
 * locales. Ver nota de cabecera del módulo.
 * @private
 */
function _fixExcelDateRow(row) {
  const fixed = { ...row };
  for (const key of Object.keys(fixed)) {
    const val = fixed[key];
    if (val instanceof Date && !isNaN(val.getTime())) {
      fixed[key] = new Date(
        val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate(),
        val.getUTCHours(), val.getUTCMinutes(), val.getUTCSeconds()
      );
    }
  }
  return fixed;
}

/**
 * Descompone un número serial de Excel en sus componentes de calendario
 * puros. 25569 = offset estándar de días entre la época de Excel
 * (1899-12-30) y la época de JS (1970-01-01). Se usa Date.UTC()
 * únicamente como calculadora de calendario (para no reimplementar
 * reglas de años bisiestos a mano) — el objeto Date resultante NUNCA
 * se serializa ni se le leen getters locales, solo los UTC, que son
 * deterministas sin importar la zona horaria del navegador.
 * @private
 */
function _serialToParts(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d  = new Date(ms);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, day: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(),
    hasTime: (serial % 1) > (0.5 / 86400)
  };
}

/**
 * Formatea un serial de Excel como "DD/MM/YYYY" o "DD/MM/YYYY HH:mm"
 * — SIEMPRE en este formato, sin depender del formato de la celda de
 * origen ni de ninguna configuración regional. Ver nota de cabecera.
 * @private
 */
function _fmtSerial(serial, withTime) {
  const p   = _serialToParts(serial);
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${pad(p.day)}/${pad(p.mo)}/${p.y}`;
  return (withTime && p.hasTime) ? `${datePart} ${pad(p.h)}:${pad(p.mi)}` : datePart;
}

/**
 * Columnas de RUTEO NUEVO cuyo valor final debe ser texto
 * DD/MM/YYYY[ HH:mm] calculado desde el serial puro — nunca texto
 * `.w` de SheetJS, nunca un objeto Date. `withTime:false` solo aplica
 * a FECHA (regla de negocio: la primera columna del archivo final es
 * fecha, no fecha+hora).
 * @private
 */
const RAW_SERIAL_SOURCE_COLS = {
  'FECHA':     false,
  'T.E':       true,
  'T.R':       true,
  'SOLICITUD': true,
  'ENRAMPE':   true,
  'RETIRO':    true,
};

/**
 * Sobreescribe, para cada columna de RAW_SERIAL_SOURCE_COLS, el valor
 * de `rows[i]` con el texto calculado desde el serial puro de la celda
 * correspondiente en `rawNumRows` (lectura con cellDates:false). Si la
 * celda no es numérica (texto suelto, vacío), se conserva tal cual sin
 * interpretarla — nunca se fuerza una conversión sobre un valor que no
 * es un serial real.
 * @private
 */
function _applyRawSourceDates(rows, rawNumRows) {
  rows.forEach((row, i) => {
    const src = rawNumRows[i];
    if (!src) return;
    for (const [key, withTime] of Object.entries(RAW_SERIAL_SOURCE_COLS)) {
      const v = src[key];
      if (typeof v === 'number' && v > 0) {
        row[key] = _fmtSerial(v, withTime);
      } else if (v !== undefined && v !== '') {
        row[key] = String(v).trim();
      }
    }
  });
}

/**
 * Lee el archivo Excel y extrae:
 *   - rows: array de rows de la hoja RUTEO NUEVO (o la primera hoja si no
 *     se encuentra un nombre coincidente)
 *   - factData: Map invoice# → { gls, horaFact }, leído de la hoja
 *     CONCENTRADO FACTURAS si existe y tiene una columna de invoice
 *     reconocible (INVOICE / FACTURA / FOLIO)
 *
 * @param {File} file
 * @returns {Promise<{
 *   rows: Array<object>,
 *   factData: Map<string, {gls:string, horaFact:string}>,
 *   ruteoName: string,
 *   factSheetLabel: string
 * }>}
 */
export async function processXLS(file) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array', cellDates: true });

  const ruteoName = wb.SheetNames.find(n =>
    SHEET_RUTEO.some(s => n.toUpperCase().includes(s.toUpperCase()))
  ) || wb.SheetNames[0];
  const wsRuteo = wb.Sheets[ruteoName];
  const raw     = XLSX.utils.sheet_to_json(wsRuteo, { defval: '' }).map(_fixExcelDateRow);

  // Segunda lectura, independiente, con cellDates:false — se reutiliza
  // para AMBAS hojas (RUTEO NUEVO y CONCENTRADO FACTURAS) para obtener
  // seriales numéricos puros, sin que SheetJS los convierta a Date ni
  // a texto formateado. Ver nota de cabecera "FIX v2" y "FIX v3".
  const wbNum      = XLSX.read(buf, { type: 'array', cellDates: false });
  const wsRuteoNum = wbNum.Sheets[ruteoName];
  const rawNumRows = XLSX.utils.sheet_to_json(wsRuteoNum, { defval: '' });
  _applyRawSourceDates(raw, rawNumRows);

  const factName = wb.SheetNames.find(n =>
    SHEET_FACTURAS.some(s => n.toUpperCase().includes(s.toUpperCase()))
  );
  const newFactData = new Map();
  let factSheetLabel = '';

  if (factName) {
    const wsFact  = wb.Sheets[factName];
    const rawFact = XLSX.utils.sheet_to_json(wsFact, { defval: '' }).map(_fixExcelDateRow);
    const keys    = Object.keys(rawFact[0] || {});
    const colInv  = keys.find(k => /INVOICE|FACTURA|FOLIO/i.test(k));
    const colLoad = keys.find(k => /LOAD|GLS/i.test(k));
    const colFin  = keys.find(k => /FINAL|HORA|FACTURACION|TS/i.test(k));

    // FIX v3: seriales puros de la MISMA hoja de facturas, vía wbNum
    // (cellDates:false) — para calcular colFin sin pasar por Date.
    const wsFactNum  = wbNum.Sheets[factName];
    const rawFactNum = wsFactNum ? XLSX.utils.sheet_to_json(wsFactNum, { defval: '' }) : [];

    if (colInv) {
      rawFact.forEach((r, i) => {
        const inv = String(r[colInv] || '').trim();
        if (!inv) return;
        const rawVal = rawFactNum[i] ? rawFactNum[i][colFin] : undefined;
        let horaFact = '';
        if (colFin) {
          horaFact = (typeof rawVal === 'number' && rawVal > 0)
            ? _fmtSerial(rawVal, true)          // serial puro — ruta robusta
            : formatFactDate(r[colFin]);        // fallback — celda no numérica
        }
        newFactData.set(inv, {
          gls: colLoad ? String(r[colLoad] || '').trim() : '',
          horaFact
        });
      });
      factSheetLabel = `${newFactData.size} facturas (${factName})`;
    } else {
      factSheetLabel = 'hoja facturas sin columna INVOICE';
    }
  } else {
    factSheetLabel = `sin hoja CONCENTRADO FACTURAS`;
  }

  return { rows: raw, factData: newFactData, ruteoName, factSheetLabel };
}
