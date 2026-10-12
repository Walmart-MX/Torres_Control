/**
 * features/citas/cita-pattern-registry.js
 * CITA PATTERN REGISTRY — motor puro de reconocimiento de variantes de
 * cita. Sin dependencias de Supabase/State/DOM — solo transforma datos.
 *
 * PROBLEMA QUE RESUELVE (confirmado con EduarDo, oct-2026):
 *   processors/pdf.js reconoce citas con dos regex fijos (fecha
 *   DD/MM/AAAA o DD-MM-AAAA, hora HH:MM). Cualquier variante que la
 *   operación capture distinto — separador con punto, año a 2 dígitos,
 *   día/mes sin cero a la izquierda, orden mes/día, hora con "h" en vez
 *   de ":" — caía siempre a `citaMisses` (telemetría del Centro de
 *   Mantenimiento), y agregar soporte para un formato nuevo exigía
 *   tocar el regex en pdf.js y esperar un despliegue de código.
 *
 * SOLUCIÓN — catálogo self-service:
 *   Un catálogo de "variantes de cita" (tabla cita_patterns, ver
 *   cita-pattern-store.js), editable desde Administración → Centro de
 *   Mantenimiento → "Variantes de Cita" (ver ui/cita-pattern-ui.js).
 *   Cada variante es un objeto de CONFIGURACIÓN (orden de fecha,
 *   separador, dígitos de año, etc.) — nunca una regex escrita a mano
 *   por el operador. Esto evita dos riesgos: que alguien sin
 *   experiencia en regex tenga que escribir una, y que una regex mal
 *   formada rompa la detección de citas para todos. Este módulo es el
 *   ÚNICO lugar que traduce esa configuración a un RegExp real —
 *   agregar una opción nueva de formato en el futuro (ej. un separador
 *   de hora distinto) es un cambio aquí, nunca en pdf.js.
 *
 * INDEPENDENCIA DE pdf.js: por diseño explícito de ese archivo ("pdf.js
 * no debe depender de ningún otro módulo propio", ver su cabecera),
 * pdf.js NO importa este módulo — mantiene una copia local mínima de
 * build/match (_buildCitaVariantMatcher/_matchCitaVariant) con un
 * comentario cruzado hacia este archivo. Si cambias la forma de
 * construir el regex aquí, cambia también esa copia. Este archivo es
 * el que consume la UI de administración (vista previa en vivo del
 * formato, sin exponer regex al operador).
 *
 * El regex ORIGINAL de pdf.js nunca se reemplaza — las variantes de
 * este catálogo son siempre un FALLBACK, se prueban solo si el formato
 * estándar no matcheó.
 */

/** Opciones válidas — únicas fuentes de verdad para los <select> de la UI. */
export const DATE_ORDERS = [
  { value: 'DMY', label: 'Día / Mes / Año' },
  { value: 'MDY', label: 'Mes / Día / Año' },
  { value: 'YMD', label: 'Año / Mes / Día' },
];
export const DATE_SEPS = [
  { value: '/', label: '/' },
  { value: '-', label: '-' },
  { value: '.', label: '.' },
];
export const TIME_SEPS = [
  { value: ':', label: ':' },
  { value: '.', label: '.' },
  { value: 'h', label: 'h' },
];

const _DATE_SEP_RE = { '/': '/', '-': '-', '.': '\\.' };
const _TIME_SEP_RE = { ':': '[:.;]', '.': '\\.', h: '[hH]' };
const _ORDER_SLOTS = { DMY: ['D', 'M', 'Y'], MDY: ['M', 'D', 'Y'], YMD: ['Y', 'M', 'D'] };

/**
 * Construye los matchers de fecha/hora de UNA variante configurada.
 * @param {object} pattern — fila de cita_patterns
 * @returns {{dateRe:RegExp, timeRe:RegExp|null, order:string[], yearDigits:number}}
 */
export function buildCitaMatchers(pattern) {
  const digit = pattern.allow_single_digit ? '\\d{1,2}' : '\\d{2}';
  const year  = pattern.year_digits === 2 ? '\\d{2}' : '\\d{4}';
  const sep   = _DATE_SEP_RE[pattern.date_sep] || _DATE_SEP_RE['/'];
  const order = _ORDER_SLOTS[pattern.date_order] || _ORDER_SLOTS.DMY;
  const parts = order.map(slot => (slot === 'Y' ? year : digit));

  const dateRe = new RegExp(`(${parts[0]})${sep}(${parts[1]})${sep}(${parts[2]})`);
  const timeRe = pattern.has_time
    ? new RegExp(`(\\d{1,2})${_TIME_SEP_RE[pattern.time_sep] || _TIME_SEP_RE[':']}\\s*(\\d{2})(?![\\/\\-\\d])`)
    : null;

  return { dateRe, timeRe, order, yearDigits: pattern.year_digits === 2 ? 2 : 4 };
}

/**
 * Prueba un texto contra UNA variante ya compilada.
 * @param {string} text
 * @param {{dateRe:RegExp, timeRe:RegExp|null, order:string[], yearDigits:number}} matchers
 * @returns {{day:number,month:number,year:number,hour:number|null,minute:number|null}|null}
 */
export function matchWithPattern(text, matchers) {
  const m = text.match(matchers.dateRe);
  if (!m) return null;
  const parts = {};
  matchers.order.forEach((slot, i) => { parts[slot] = parseInt(m[i + 1], 10); });

  const year = matchers.yearDigits === 2 ? parts.Y + 2000 : parts.Y;
  let hour = null, minute = null;
  if (matchers.timeRe) {
    const tm = text.match(matchers.timeRe);
    if (tm) { hour = parseInt(tm[1], 10); minute = parseInt(tm[2], 10); }
  }
  return { day: parts.D, month: parts.M, year, hour, minute };
}

/**
 * Genera un texto de ejemplo representativo de una variante — usado
 * por la UI de administración como "vista previa en vivo" para que el
 * operador confirme que el formato que configuró se parece a lo que
 * vio, sin tener que leer ni escribir regex.
 * @param {object} pattern
 * @returns {string} ej. "04/10/2026" o "4-10-26 10h30"
 */
export function sampleCitaText(pattern) {
  const d = pattern.allow_single_digit ? '4' : '04';
  const mo = pattern.allow_single_digit ? '1' : '10';
  const y = pattern.year_digits === 2 ? '26' : '2026';
  const order = _ORDER_SLOTS[pattern.date_order] || _ORDER_SLOTS.DMY;
  const bySlot = { D: d, M: mo, Y: y };
  let out = order.map(slot => bySlot[slot]).join(pattern.date_sep || '/');
  if (pattern.has_time) out += ' 10' + (pattern.time_sep || ':') + '30';
  return out;
}
