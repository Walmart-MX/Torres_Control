/**
 * utils/dom.js
 * Utilidades de manipulación segura del DOM.
 * Funciones puras — sin dependencias externas.
 */

/**
 * Escapa caracteres especiales HTML para evitar XSS.
 * Uso: insertar texto de usuario dentro de innerHTML.
 * @param {*} s — cualquier valor, se convierte a string
 * @returns {string}
 */
export function escH(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
