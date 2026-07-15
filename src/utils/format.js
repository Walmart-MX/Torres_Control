/**
 * utils/format.js
 * Utilidades de formato y normalización de texto.
 * Funciones puras — sin dependencias externas.
 */

/**
 * Normaliza el nombre de un operador para usarse como clave de catálogo.
 * Convierte a mayúsculas y colapsa espacios múltiples.
 * @param {string} s
 * @returns {string}
 */
export function normOp(s) {
  return String(s).trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Calcula un porcentaje y lo devuelve como string con símbolo %.
 * @param {number} v — valor parcial
 * @param {number} t — total
 * @returns {string} ej. "75%"
 */
export function pct(v, t) {
  return t ? Math.round(v / t * 100) + '%' : '0%';
}

/**
 * Formatea un objeto Date a string legible "YYYY-MM-DD HH:MM".
 * Se conserva sin cambios — sigue en uso por ui.js (_renderRowsBody)
 * para columnas Date que no pasan por el pipeline de texto crudo
 * (HR. DESPACHO, CITA, SALIDA DE CASETA — no vienen de RUTEO NUEVO
 * ni de CONCENTRADO FACTURAS).
 * @param {Date} d
 * @returns {string}
 */
export function fmtDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Convierte un número serial de Excel a texto "DD/MM/YYYY" o
 * "DD/MM/YYYY HH:mm" — cálculo de calendario puro, sin objetos Date
 * con getters locales de por medio. Misma técnica que
 * processors/excel.js usa para las columnas de RUTEO NUEVO (ver su
 * nota de cabecera "FIX (fidelidad de fecha/hora — v2)"). El serial de
 * Excel no tiene zona horaria — es solo "días desde 1899-12-30" — así
 * que el cálculo se hace enteramente con getters UTC del Date
 * intermedio (usado únicamente como calculadora de calendario, nunca
 * serializado ni leído con getters locales).
 * @param {number} serial
 * @param {boolean} [withTime=true] — incluir HH:mm si la celda trae hora
 * @returns {string}
 */
export function serialToText(serial, withTime = true) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d  = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const pad      = n => String(n).padStart(2, '0');
  const dateStr  = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  const hasTime  = (serial % 1) > (0.5 / 86400);
  return (withTime && hasTime) ? `${dateStr} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : dateStr;
}

/**
 * Convierte un valor de celda Excel (Date, número serial, string)
 * a un string de fecha/hora legible "DD/MM/YYYY HH:mm".
 *
 * FIX (fidelidad de HORA DE FACTURACION — julio 2026): la rama
 * numérica antes construía un Date anclado en UTC a partir del serial
 * y lo formateaba con fmtDate() — que lee con getters LOCALES. Ese
 * desajuste UTC/local desplazaba la hora exactamente el offset de la
 * zona horaria del navegador (mismo bug de fondo que ENRAMPE/RETIRO).
 * Ahora usa serialToText(), que hace el cálculo enteramente en UTC sin
 * depender de la zona horaria del navegador.
 *
 * La rama Date se conserva con getters LOCALES a propósito: los
 * objetos Date que llegan aquí ya fueron reconstruidos por
 * _fixExcelDateRow() en excel.js (que los arma con el constructor
 * LOCAL de Date usando los componentes UTC originales) — por diseño,
 * para ESE tipo de Date específico, son los getters locales los que
 * devuelven los valores correctos, no los UTC.
 *
 * @param {Date|number|string} val
 * @returns {string}
 */
export function formatFactDate(val) {
  if (!val && val !== 0) return '';

  if (typeof val === 'number') {
    return serialToText(val, true) || String(val);
  }

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return String(val);
    const pad     = n => String(n).padStart(2, '0');
    const dateStr = `${pad(val.getDate())}/${pad(val.getMonth() + 1)}/${val.getFullYear()}`;
    const hasTime = val.getHours() !== 0 || val.getMinutes() !== 0 || val.getSeconds() !== 0;
    return hasTime ? `${dateStr} ${pad(val.getHours())}:${pad(val.getMinutes())}` : dateStr;
  }

  return String(val).trim();
}
