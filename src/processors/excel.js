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
 * FIX (fidelidad de fecha/hora — julio 2026, v2):
 *   Intento previo: para FECHA/ENRAMPE/RETIRO/SOLICITUD DE ENRAMPE/
 *   TEMP. ENRAMPE/TEMP. DESENRAMPE se leía el texto ya formateado por
 *   SheetJS (`.w`, con `raw:false`). Resultó INSUFICIENTE: `.w` no es
 *   una copia neutral de la celda — SheetJS lo genera aplicando el
 *   código de formato numérico de la celda de origen (ej. "m/d/yy
 *   h:mm") con su propia librería de formato (SSF), que interpreta ese
 *   patrón literalmente y SIN CONOCIMIENTO de la configuración regional
 *   con la que el usuario ve el archivo en su Excel. Resultado: una
 *   celda que el usuario ve como "02/07/2026 00:38" en su Excel (con
 *   configuración regional es-MX) se leía como "7/2/26 0:38" — el
 *   mismo tipo de ambigüedad de formato que se buscaba eliminar, solo
 *   que trasladada a SheetJS en vez de a `new Date()`.
 *
 *   Causa raíz real: cualquier acercamiento basado en TEXTO formateado
 *   (sea por Excel, por SheetJS, o por Date) hereda la ambigüedad del
 *   formato de origen. La única fuente sin ambigüedad es el número
 *   serial de Excel — un valor puro (días desde 1899-12-30 + fracción
 *   de día), sin zona horaria ni locale de por medio. Solución:
 *   _serialToParts()/_fmtSerial() calculan los componentes de
 *   calendario directamente desde ese número con aritmética simple
 *   (vía Date.UTC, pero SOLO se leen sus getters UTC — nunca locales,
 *   nunca se serializa ese Date a ningún lado) y se formatean siempre
 *   como DD/MM/YYYY [HH:mm], sin importar el formato de la celda de
 *   origen ni la configuración regional del navegador.
 *
 *   Para obtener el serial puro se necesita una lectura del workbook
 *   con `cellDates:false` — la lectura principal (`raw`, usada para el
 *   resto de columnas) usa `cellDates:true` a propósito, así que se
 *   hace una segunda lectura independiente solo para esto.
 *
 * Dependencias:
 *   - XLSX (SheetJS, cargado globalmente desde el CDN en index.html)
 *   - SHEET_RUTEO, SHEET_FACTURAS (core/constants.js) — nombres alternativos
 *     de hoja que se buscan por coincidencia parcial, insensible a mayúsculas
 *   - formatFactDate (utils/format.js) — normaliza el valor de la celda de
 *     fecha de facturación (puede venir como Date, número serial o string)
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
 * (1899-12-30) y la época de JS (1970-01-01) — misma constante que ya
 * usa utils/format.js → formatFactDate() para números seriales.
 * Se usa Date.UTC() únicamente como calculadora de calendario (para no
 * reimplementar reglas de años bisiestos a mano) — el objeto Date
 * resultante NUNCA se serializa ni se le leen getters locales, solo
 * los UTC, que son deterministas sin importar la zona horaria del
 * navegador.
 * @private
 */
function _serialToParts(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d  = new Date(ms);
  return {
    y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, day: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(),
    // Tolerancia de medio segundo — distingue una celda que sí trae
    // hora de una que es fecha pura (fracción de día ~0).
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

  // Segunda lectura, independiente, SOLO para obtener los seriales
  // numéricos puros de RAW_SERIAL_SOURCE_COLS — ver nota de cabecera
  // "FIX (fidelidad de fecha/hora — v2)". cellDates:false conserva el
  // número tal cual, sin que SheetJS lo convierta a Date ni a texto.
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
    if (colInv) {
      for (const r of rawFact) {
        const inv = String(r[colInv] || '').trim();
        if (!inv) continue;
        newFactData.set(inv, {
          gls:      colLoad ? String(r[colLoad] || '').trim() : '',
          horaFact: colFin  ? formatFactDate(r[colFin])        : ''
        });
      }
      factSheetLabel = `${newFactData.size} facturas (${factName})`;
    } else {
      factSheetLabel = 'hoja facturas sin columna INVOICE';
    }
  } else {
    factSheetLabel = `sin hoja CONCENTRADO FACTURAS`;
  }

  return { rows: raw, factData: newFactData, ruteoName, factSheetLabel };
}
