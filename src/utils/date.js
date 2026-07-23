/**
 * utils/date.js
 * Pipeline de normalización y parseo de fechas/horas.
 *
 * Arquitectura: 11 funciones puras en cascada, orquestadas por
 * normalizeAppointment(). Cada función tiene una sola responsabilidad.
 * Ninguna función tiene efectos secundarios ni dependencias externas.
 */

// ─── Pasos del pipeline (privados, no exportados) ───────────────────────────

/** Paso 1 — Colapsa corridas de espacios y recorta los extremos */
function _normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Paso 2 — Elimina caracteres sin valor de fecha/hora.
 * Conserva: dígitos, / - . _ , | : ; y espacio.
 */
function _removeNoiseChars(s) {
  return s.replace(/[*#@~^'"()\[\]{}<>!?=%&$\\]/g, ' ');
}

/**
 * Paso 3 — Colapsa dígitos individuales separados por espacio.
 * "2 2" → "22", "0 6" → "06"
 */
function _normalizeNumericGroups(s) {
  return s.replace(/([0-9][0-9 ]*[0-9]|[0-9])/g, token => {
    const parts = token.split(' ');
    if (parts.every(p => p.length <= 1)) return parts.join('');
    return token;
  });
}

/**
 * Paso 4 — Reconstruye formatos compactos sin separadores.
 * Soporta: DDMMYYYYHHMM (12 dígitos) y DDMMYYYY[sep]HHMM (8+4).
 */
function _reconstructCompactDateTime(s) {
  if (s.includes('/')) return s;

  // 12 dígitos consecutivos: DDMMYYYYHHMM
  const c12 = s.replace(/\D/g, '');
  if (c12.length === 12) {
    const dd = c12.slice(0, 2), mm = c12.slice(2, 4),
          yy = c12.slice(4, 8), hh = c12.slice(8, 10), mn = c12.slice(10, 12);
    if (+dd >= 1 && +dd <= 31 && +mm >= 1 && +mm <= 12 &&
        +yy >= 2000 && +yy <= 2099 && +hh <= 23 && +mn <= 59) {
      return `${dd}/${mm}/${yy} ${hh}:${mn}`;
    }
  }

  // Patrón 8+4: DDMMYYYY[sep opcional]HH[sep]MM
  const m8 = s.replace(/\s/g, '').match(
    /^(\d{2})(\d{2})(\d{4})[-_. ]?(\d{2})[:.]?(\d{2})$/
  );
  if (m8) {
    const [, dd, mm, yy, hh, mn] = m8;
    if (+dd >= 1 && +dd <= 31 && +mm >= 1 && +mm <= 12 &&
        +yy >= 2000 && +yy <= 2099 && +hh <= 23 && +mn <= 59) {
      return `${dd}/${mm}/${yy} ${hh}:${mn}`;
    }
  }
  return s;
}

/**
 * Paso 5 — Convierte fechas separadas solo por espacios.
 * "DD MM YYYY [HH:MM]" → "DD/MM/YYYY [HH:MM]"
 */
function _normalizeSpaceSeparatedDate(s) {
  if (s.includes('/')) return s;
  return s.replace(/^(\d{1,2}) (\d{1,2}) (\d{4})(.*)$/, '$1/$2/$3$4');
}

/**
 * Paso 6 — Inserta espacio entre año y hora cuando están pegados.
 * "/202610" → "/2026 10"
 */
function _splitYearHour(s) {
  return s.replace(/(\/\d{4})(\d{2})(?=[;:. ]|$)/g, '$1 $2');
}

/**
 * Paso 7 — Unifica separadores de fecha a /.
 * Acepta: - . _ , | y sus variantes con espacios.
 */
function _normalizeDateSeparators(s) {
  return s
    .replace(/(\d)\s*[-._,|]\s*(\d)/g, '$1/$2')
    .replace(/(\d)\s+(\d{1,2}[\/])/g,  '$1/$2')
    .replace(/(\/\d{1,2})\s+(\d)/g,    '$1/$2');
}

/**
 * Paso 8 — Unifica separadores de hora a :.
 * Acepta: ; . _ , | y variantes dobles (::, ;;).
 */
function _normalizeTimeSeparators(s) {
  s = s.replace(/([;.,:_|])\1+/g, '$1');
  s = s.replace(/(\d{1,2})[;._,|](\d{2})(?!\d)/g, '$1:$2');
  s = s.replace(/(\d{1,2}) (\d{2})$/, '$1:$2');
  return s;
}

/** Paso 9 — Elimina separadores dobles resultantes de pasos anteriores */
function _removeRepeatedSeparators(s) {
  return s
    .replace(/\/{2,}/g, '/')
    .replace(/-{2,}/g,  '-')
    .replace(/:{2,}/g,  ':')
    .replace(/\.{2,}/g, '.');
}

/**
 * Paso 10 — Normaliza el padding de horas y minutos.
 * "8:05" → "08:05", "10:1" → "10:01"
 */
function _normalizeTimePadding(s) {
  s = s.replace(
    /(\d{1,2}):(\d)(?!\d)/g,
    (_, h, m) => h.padStart(2, '0') + ':' + m.padStart(2, '0')
  );
  s = s.replace(
    /(?<![\/\d])(\d):(\d{2})(?!\d)/g,
    (_, h, m) => h.padStart(2, '0') + ':' + m
  );
  return s;
}

/** Paso 11 — Valida que el resultado tenga el formato DD/MM/YYYY HH:MM */
function _validateNormalizedDate(s) {
  return /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/.test(s.trim());
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Normaliza cualquier representación de fecha+hora al formato DD/MM/YYYY HH:MM.
 * Si no puede reconocer el valor lo devuelve tal cual (sin perder datos).
 *
 * @param {*} val — string, número o Date de entrada
 * @returns {string} — string normalizado o el original si no se reconoce
 */
export function normalizeAppointment(val) {
  if (!val) return '';
  let s = String(val);
  s = _normalizeWhitespace(s);
  s = _removeNoiseChars(s);
  s = _normalizeWhitespace(s);
  s = _normalizeNumericGroups(s);
  s = _reconstructCompactDateTime(s);
  s = _normalizeSpaceSeparatedDate(s);
  s = _splitYearHour(s);
  s = _normalizeDateSeparators(s);
  s = _normalizeTimeSeparators(s);
  s = _removeRepeatedSeparators(s);
  s = _normalizeWhitespace(s);
  s = _normalizeTimePadding(s);
  return s.trim();
}

/**
 * Normaliza una fecha/hora del panel de despacho (texto pegado desde Excel).
 * Si el valor es solo una hora HH:MM, le antepone la fecha de hoy.
 *
 * @param {*} val
 * @returns {string} — "DD/MM/YYYY HH:MM" o string normalizado
 */
export function normDateTime(val) {
  if (!val) return '';
  const s = normalizeAppointment(String(val).trim());
  if (/^\d{2}:\d{2}$/.test(s)) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${d}/${m}/${y} ${s}`;
  }
  return s;
}

/**
 * Convierte un string normalizado (DD/MM/YYYY HH:MM) o ISO a objeto Date.
 * Devuelve null si no puede parsear.
 *
 * @param {string} s
 * @returns {Date|null}
 */
export function parseDateTime(s) {
  if (!s) return null;

  const normalized = normalizeAppointment(String(s));

  // Formato primario: DD/MM/YYYY HH:MM
  const m1 = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (m1) {
    return new Date(+m1[3], +m1[2] - 1, +m1[1], +m1[4], +m1[5], 30);
  }

  // Fallback: ISO YYYY-MM-DD HH:MM
  const m2 = String(s).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (m2) {
    return new Date(+m2[1], +m2[2] - 1, +m2[3], +m2[4], +m2[5], 30);
  }

  // Último recurso: constructor nativo de Date
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
// ─── Nombres de días en español (calendario Gregoriano estándar) ──────────
// No confundir con la Semana Walmart (SW) — DIA es el día calendario
// normal de la fecha de la ruta, sin relación con el calendario fiscal
// 4-5-4. Por eso vive aquí y no en core/fiscal-calendar.js.

const DIAS_ES = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

/**
 * Devuelve el nombre del día de la semana en español, mayúsculas,
 * a partir de un objeto Date. Usado para automatizar la columna DIA
 * del Excel exportado (antes captura manual).
 * @param {Date} date
 * @returns {string} — ej. 'LUNES', o '' si date no es válido
 */
export function dayNameEs(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return DIAS_ES[date.getDay()];
}

/**
 * Resuelve cualquier representación de row['FECHA'] a un objeto Date
 * válido en hora LOCAL, sin ambigüedad de formato.
 *
 * FIX (root cause — bug DIA/SW/FECHA incorrectos para celdas de texto):
 *   row['FECHA'] no siempre llega como Date. Cuando la celda del Excel
 *   origen no tiene formato de fecha aplicado (columna capturada como
 *   texto, común en hojas mantenidas manualmente), SheetJS la entrega
 *   como STRING — ej. "02/07/2026". El código anterior, en ese caso,
 *   delegaba en el parser nativo `new Date(string)`, que asume
 *   convención estadounidense MM/DD/YYYY — interpretando "02/07/2026"
 *   como 7 de FEBRERO en vez de 2 de JULIO. Esta función NUNCA delega
 *   en new Date(string) para texto: parsea explícitamente DD/MM/YYYY,
 *   la convención que usa el resto de esta app (ver parseDateTime,
 *   normalizeAppointment más abajo en este mismo archivo).
 *
 *   También cubre el caso de número serial de Excel crudo (celda sin
 *   NINGÚN formato, ni siquiera texto — cellDates:true de SheetJS no
 *   la convierte). Mismo cálculo de offset que formatFactDate() en
 *   utils/format.js, pero reconstruido a componentes LOCALES (mismo
 *   patrón que excel.js → _fixExcelDateRow) en vez de dejarlo anclado
 *   en UTC.
 *
 * Única fuente de verdad — usada por processors/merge.js (cálculo de
 * SW/DIA) y features/export.js (columna FECHA del Excel exportado).
 * Si en el futuro aparece un tercer lugar que necesite resolver
 * row['FECHA'], debe importar esta función, no reimplementar el parseo.
 *
 * @param {Date|number|string} raw
 * @returns {Date|null} — null si no se pudo resolver de forma inequívoca
 */
export function resolveExcelDate(raw) {
  if (!raw && raw !== 0) return null;

  // Caso 1: ya es un Date válido (celda con formato de fecha, ya
  // corregida de zona horaria por excel.js → _fixExcelDateRow).
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw;
  }

  // Caso 2: número serial de Excel crudo (celda sin formato de fecha
  // — ni date ni texto — cellDates:true no la convirtió).
  if (typeof raw === 'number') {
    const utcMs   = Math.round((raw - 25569) * 86400 * 1000);
    const utcDate = new Date(utcMs);
    if (isNaN(utcDate.getTime())) return null;
    return new Date(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate());
  }

  // Caso 3: texto — SIEMPRE se asume DD/MM/YYYY. Jamás se delega en
  // el parser nativo new Date(string) — ver nota de cabecera.
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    const d = new Date(+yyyy, +mm - 1, +dd);
    // Validación defensiva: si día/mes no forman una fecha real
    // (ej. "32/13/2026"), el constructor Date "normaliza" corriéndose
    // de mes en vez de fallar — se detecta comparando contra los
    // componentes originales.
    if (d.getFullYear() === +yyyy && d.getMonth() === +mm - 1 && d.getDate() === +dd) {
      return d;
    }
  }
  return null;
}
