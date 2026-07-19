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
 * "DD/MM/YYYY HH:mm" — cálculo de calendario puro.
 * @param {number} serial
 * @param {boolean} [withTime=true]
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

/**
 * Elimina diacríticos (acentos, diéresis, etc.) de un string, dejando
 * el carácter base. Usado para normalizar encabezados de archivos
 * externos (ej. Reporte WTMS) antes de aplicar los regex de detección
 * de columnas — el mismo encabezado puede llegar con o sin acentos
 * dependiendo del export. NFD descompone cada carácter acentuado en
 * base + marca diacrítica combinante (rango \u0300-\u036f), que luego
 * se elimina.
 * @param {*} s
 * @returns {string}
 */
export function stripAccents(s) {
  return String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
