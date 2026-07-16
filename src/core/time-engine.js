/**
 * core/time-engine.js
 * TIME ENGINE — motor genérico de cálculos de tiempo, reemplaza las
 * fórmulas de Excel para TIEMPO ENRAMPE, TIEMP APROX DE CARGA,
 * RETIRO VS DESPACHO, TIEMPO DE DESP, TIEMPO EN PATIO.
 *
 * Config-driven: TIME_RULES define cada cálculo como { out, a, b, mode }.
 * Agregar un cálculo nuevo = una entrada más en TIME_RULES — computeTimes()
 * no cambia.
 *
 * a/b son NOMBRES DE COLUMNA DEL EXPORT FINAL (ej. 'HR. DESPACHO'), no
 * nombres de campo interno — se resuelven con getMapped(), la misma
 * función que ya usa toda la app para no reimplementar dónde vive
 * realmente cada valor (ej. 'HR. DESPACHO' → nr['_HR_DESP'] ||
 * nr['_HR_DESP_PDF']). Esto es clave: si mañana cambia de dónde sale
 * HR. DESPACHO, este motor no se toca — solo COL_MAP en constants.js.
 *
 * mode:
 *   'diff'    — a - b, en minutos. Si el resultado es negativo (orden
 *               invertido de los eventos), se deja vacío y se reporta
 *               como anomalía — NUNCA se fuerza a positivo, porque eso
 *               ocultaría un problema real de captura.
 *   'absdiff' — |a - b| — usado en RETIRO VS DESPACHO por regla de
 *               negocio explícita: no importa el signo, solo la magnitud.
 *
 * Dependencias:
 *   - getMapped (core/constants.js)
 *   - parseDateTime (utils/date.js)
 */
import { getMapped } from './constants.js';
import { parseDateTime } from '../utils/date.js';

export const TIME_RULES = [
  { out: 'TIEMPO ENRAMPE',       a: 'ENRAMPE',           b: 'SOLICITUD DE ENRAMPE', mode: 'diff'    },
  { out: 'TIEMP APROX DE CARGA', a: 'RETIRO',            b: 'ENRAMPE',              mode: 'diff'    },
  { out: 'RETIRO VS DESPACHO',   a: 'RETIRO',            b: 'HR. DESPACHO',         mode: 'absdiff' },
  { out: 'TIEMPO DE DESP',       a: 'HR. DESPACHO',      b: 'HORA DE FACTURACION',  mode: 'diff'    },
  { out: 'TIEMPO EN PATIO',      a: 'SALIDA DE CASETA ', b: 'HR. DESPACHO',         mode: 'diff'    },
];

// Umbral para marcar una duración como "sospechosa" — no bloquea nada,
// solo alimenta una incidencia INFORMATIVA en el SVE (ver sve.js regla O).
const ANOMALY_MINUTES = 8 * 60;

/** @private */
function _fmtMinutes(mins) {
  const sign = mins < 0 ? '-' : '';
  const abs  = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * Calcula todos los TIME_RULES para una fila y escribe el resultado
 * directamente en nr[rule.out] (formato "HH:MM", vacío si no se pudo
 * calcular). Debe llamarse DESPUÉS de que nr tenga ya resueltos todos
 * sus campos de fecha/hora (PDF, despacho, facturación) — ver el punto
 * de llamada en merge.js, al final del loop.
 *
 * @param {object} nr — fila final en construcción (mutada in-place)
 * @returns {Array<{rule:string, reason:'orden_invertido'|'duracion_anormal', minutes:number}>}
 */
export function computeTimes(nr) {
  const anomalies = [];
  for (const rule of TIME_RULES) {
    const dA = parseDateTime(getMapped(nr, rule.a));
    const dB = parseDateTime(getMapped(nr, rule.b));
    if (!dA || !dB) { nr[rule.out] = ''; continue; }

    let mins = Math.round((dA - dB) / 60000);
    if (rule.mode === 'absdiff') mins = Math.abs(mins);

    if (rule.mode === 'diff' && mins < 0) {
      nr[rule.out] = '';
      anomalies.push({ rule: rule.out, reason: 'orden_invertido', minutes: mins });
      continue;
    }

    nr[rule.out] = _fmtMinutes(mins);
    if (Math.abs(mins) > ANOMALY_MINUTES) {
      anomalies.push({ rule: rule.out, reason: 'duracion_anormal', minutes: mins });
    }
  }
  return anomalies;
}
