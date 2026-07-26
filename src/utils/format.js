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
 * Convierte un valor de celda Excel (Date, número serial, string)
 * a un string de fecha/hora legible.
 * @param {Date|number|string} val
 * @returns {string}
 */
export function formatFactDate(val) {
  if (!val && val !== 0) return '';
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? String(val) : fmtDate(val);
  }
  if (typeof val === 'number') {
    // Número serial de Excel → Date JavaScript
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? String(val) : fmtDate(d);
  }
  return String(val).trim();
}
