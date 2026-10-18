/**
 * core/fiscal-calendar.js
 * WALMART FISCAL CALENDAR — única fuente de verdad para toda lógica
 * relacionada con el Calendario Fiscal Retail 4-5-4 de Walmart.
 *
 * NO usa semanas ISO ni el calendario normal. Las semanas fiscales de
 * Walmart siempre empiezan sábado 12:01 AM y terminan viernes 11:59 PM.
 * Cada año fiscal (FY) tiene su propia fecha de inicio, definida por
 * Walmart — normalmente 52 semanas, ocasionalmente 53.
 *
 * DISEÑO — por qué config-driven y no una fórmula genérica:
 *   No existe una fórmula matemática universal para "cuándo empieza
 *   cada año fiscal de Walmart" — Walmart la define y la publica cada
 *   año. Intentar derivarla algorítmicamente sería frágil y
 *   propensa a error. En su lugar, FISCAL_YEARS es una tabla de
 *   configuración explícita: un año fiscal nuevo = una línea nueva
 *   aquí, el algoritmo (_findFiscalYear, getFiscalWeek) NUNCA cambia.
 *
 * DISEÑO — por qué getFiscalWeek() lanza error en vez de devolver un
 * valor por defecto cuando la fecha no tiene FY configurado:
 *   Una SW incorrecta silenciosa es peor que un error visible — se
 *   propagaría al Excel final sin que nadie lo note hasta que alguien
 *   audite manualmente. El caller (merge.js) decide qué hacer con ese
 *   error (hoy: advertir en consola y dejar la fila sin SW, sin
 *   detener el resto del procesamiento).
 *
 * FIX DE ZONA HORARIA (mismo patrón que excel.js / export.js): las
 * fechas de configuración se parsean con el constructor LOCAL de
 * Date (new Date(y, m-1, d)), NUNCA con new Date('YYYY-MM-DD'), que
 * JavaScript interpreta como medianoche UTC y puede desalinear el día
 * en zonas horarias con offset negativo (México, UTC-6) — el mismo
 * bug de origen que ya se corrigió para la columna FECHA.
 *
 * Preparado para futuras funciones (quarter, período, rango de
 * semana) aunque hoy solo se consuma `sw` desde merge.js.
 *
 * CAMBIO (oct-2026 — proyección automática del siguiente FY):
 *   Walmart nunca detiene operaciones — la semana que sigue al cierre
 *   de un FY es, por definición, la SW01 del siguiente (sin huecos).
 *   Esa fecha de inicio SI se puede derivar sola (inicio FY actual +
 *   sus semanas × 7 dias). Lo que NO se puede derivar por lógica es
 *   CUANTAS semanas tiene ese siguiente FY (52 o 53) — eso lo decide
 *   Walmart para realinear el calendario fiscal con el calendario real
 *   cada 5-6 años, y no sigue ningún patrón calculable.
 *
 *   Por eso _effectiveFiscalYears() agrega UNA entrada "proyectada"
 *   (confirmed:false, 52 semanas asumidas) inmediatamente después del
 *   último FY configurado a mano — red de seguridad para que SW/DIA
 *   nunca dejen de calcularse el dia que se cruza el limite, aunque
 *   nadie haya tocado el codigo todavia. getFiscalWeek() devuelve
 *   confirmed:false mientras tanto y avisa UNA vez por sesion en
 *   consola. Si el FY real termina siendo de 53 semanas en vez de 52,
 *   el numero de SW se desalinea recien a partir de la semana 53 — el
 *   aviso en consola (y warnIfFiscalYearRunningOut()) existen para que
 *   alguien actualice FISCAL_YEARS con el dato real antes de llegar ahi.
 *   La entrada proyectada NUNCA pisa una entrada real: en cuanto se
 *   agrega el FY de verdad a FISCAL_YEARS, la proyección deja de usarse
 *   sola (ver _effectiveFiscalYears()).
 *
 * Sin dependencias de otros módulos propios — funciones puras.
 */

/**
 * Tabla de configuración de años fiscales. Para agregar un año nuevo:
 * una línea aquí, con la fecha de inicio (sábado, según Walmart) y la
 * cantidad de semanas de ese año (52 o 53). El algoritmo no cambia.
 *
 *   label — identificador del año fiscal (ej. 'FY27')
 *   start — fecha de inicio en formato 'YYYY-MM-DD' (siempre sábado)
 *   weeks — cantidad total de semanas de ese año fiscal (52 o 53)
 */
export const FISCAL_YEARS = [
  { label: 'FY27', start: '2026-01-31', weeks: 52 },
  // { label: 'FY28', start: '20XX-XX-XX', weeks: 52 },  ← agregar cuando Walmart publique la fecha
];

/** Parsea 'YYYY-MM-DD' como fecha LOCAL — ver nota de zona horaria en cabecera. @private */
function _parseLocalDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Normaliza cualquier Date a medianoche local, descartando hora/minutos/segundos. @private */
function _localMidnight(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Diferencia en días completos entre dos fechas (ambas ya a medianoche local). @private */
function _daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// Semanas asumidas para la proyección automática del siguiente FY —
// 52 es el caso común (un FY de 53 semanas es la excepción, no la regla).
const PROJECTED_WEEKS_DEFAULT = 52;

/** 'FY27' -> 'FY28'. Fallback generico si el label no sigue el patron 'FYnn'. @private */
function _nextLabelGuess(label) {
  const m = /^FY(\d+)$/.exec(label);
  if (!m) return `${label}+1`;
  return `FY${String(Number(m[1]) + 1).padStart(2, '0')}`;
}

/**
 * Lista de FY a considerar para ubicar una fecha: los configurados a
 * mano en FISCAL_YEARS (confirmed:true) MAS una proyección automática
 * del siguiente (confirmed:false) — ver nota de cabecera "CAMBIO
 * (oct-2026 — proyección automática del siguiente FY)". La proyección
 * jamás reemplaza una entrada real: si ya existe un FY configurado que
 * cubre una fecha, ese gana siempre (se evalua primero por orden).
 * @private
 */
function _effectiveFiscalYears() {
  const real = FISCAL_YEARS.map(fy => ({ ...fy, startDate: _parseLocalDate(fy.start), confirmed: true }));
  if (!real.length) return real;

  const sorted = [...real].sort((a, b) => a.startDate - b.startDate);
  const last = sorted[sorted.length - 1];
  const projectedStart = new Date(last.startDate.getTime() + last.weeks * 7 * 86400000);
  const projected = {
    label: `${_nextLabelGuess(last.label)} (proyectado, sin confirmar)`,
    startDate: projectedStart,
    weeks: PROJECTED_WEEKS_DEFAULT,
    confirmed: false,
  };
  return [...real, projected];
}

/**
 * Encuentra a qué año fiscal pertenece una fecha, según FISCAL_YEARS.
 * @param {Date} date — fecha ya normalizada a medianoche local
 * @returns {{label:string, startDate:Date, weeks:number}|null}
 * @private
 */
function _findFiscalYear(date) {
  const sorted = _effectiveFiscalYears().sort((a, b) => a.startDate - b.startDate);

  for (let i = 0; i < sorted.length; i++) {
    const cur  = sorted[i];
    const next = sorted[i + 1];
    // Si no hay siguiente FY (real o proyectado) después de este, se
    // asume que dura exactamente `weeks` semanas — cualquier fecha
    // después de eso cae fuera de rango y getFiscalWeek() lanza error
    // explicito (esto solo puede pasar mas alla de la proyección
    // automática, que siempre cubre "el siguiente FY").
    const curEnd = next ? next.startDate : new Date(cur.startDate.getTime() + cur.weeks * 7 * 86400000);
    if (date >= cur.startDate && date < curEnd) return cur;
  }
  return null;
}

/**
 * Calcula la información fiscal completa (SW, FY, quarter, rango de
 * semana) para una fecha dada.
 *
 * NOTA sobre `quarter` en años de 53 semanas: el cálculo asume
 * trimestres de 13 semanas exactas (Q = ceil(SW/13)), que es correcto
 * para años de 52 semanas. Walmart no siempre inserta la semana 53 en
 * el mismo punto del calendario todos los años — este campo debe
 * tratarse como orientativo hasta confirmar con la documentación
 * oficial de Walmart en qué quarter/período cae la semana extra de
 * cada año de 53 semanas específico.
 *
 * @param {Date} dateInput — fecha de referencia (normalmente row['FECHA'] del Excel)
 * @returns {{ fy:string, sw:number, quarter:number, weekStart:Date, weekEnd:Date, totalWeeksInFY:number, confirmed:boolean }}
 * @throws {Error} si la fecha no cae dentro de ningún FY configurado NI de la proyección automática
 */
let _warnedProjectedUse = false;

export function getFiscalWeek(dateInput) {
  const date = _localMidnight(dateInput);
  const fy = _findFiscalYear(date);

  if (!fy) {
    throw new Error(
      `No hay año fiscal configurado para la fecha ${date.toLocaleDateString('es-MX')}. ` +
      `Agrega la entrada correspondiente en FISCAL_YEARS (core/fiscal-calendar.js).`
    );
  }

  if (!fy.confirmed && !_warnedProjectedUse) {
    _warnedProjectedUse = true;
    console.warn(
      `[FiscalCalendar] Usando ${fy.label} para calcular SW/DIA — fecha de inicio PROYECTADA ` +
      `automaticamente (contigua al FY anterior, Walmart nunca detiene operaciones), semanas ` +
      `asumidas en ${fy.weeks} SIN CONFIRMAR por Walmart todavia. Agrega la entrada real en ` +
      `FISCAL_YEARS (core/fiscal-calendar.js) en cuanto se publique el calendario oficial — si el ` +
      `año real tiene distinta cantidad de semanas, el numero de SW se desalinea a partir de la ` +
      `semana ${fy.weeks + 1}.`
    );
  }

  const daysSinceStart = _daysBetween(fy.startDate, date);
  const weekIndex = Math.floor(daysSinceStart / 7); // 0-based
  const sw = weekIndex + 1;
  const weekStart = new Date(fy.startDate.getTime() + weekIndex * 7 * 86400000);
  const weekEnd   = new Date(weekStart.getTime() + 6 * 86400000);
  const quarter   = Math.min(4, Math.ceil(sw / 13));

  return { fy: fy.label, sw, quarter, weekStart, weekEnd, totalWeeksInFY: fy.weeks, confirmed: fy.confirmed };
}

/**
 * Atajo — devuelve solo el número de semana Walmart (SW) para una fecha.
 * Uso principal: merge.js, donde hoy solo se necesita este valor.
 * @param {Date} dateInput
 * @returns {number}
 * @throws {Error} — igual que getFiscalWeek()
 */
export function getSW(dateInput) {
  return getFiscalWeek(dateInput).sw;
}

/**
 * PENDIENTE RECURRENTE: avisa en consola cuando al último FY
 * configurado en FISCAL_YEARS le quedan pocos días — sin esto, el
 * aviso de arriba (el comentario junto a FISCAL_YEARS) vive solo en
 * texto que nadie relee hasta que ya truena en producción
 * (getFiscalWeek() empieza a lanzar error para toda fecha fuera de
 * rango, y las filas quedan sin SW/DIA — ver merge.js, que lo atrapa
 * con gracia pero no lo arregla). Llamar una vez al boot (ver core/app.js).
 * @param {number} [warnDays=30]
 */
export function warnIfFiscalYearRunningOut(warnDays = 30) {
  const sorted = [...FISCAL_YEARS].sort((a, b) => _parseLocalDate(a.start) - _parseLocalDate(b.start));
  const last = sorted[sorted.length - 1];
  if (!last) return;
  const lastStart = _parseLocalDate(last.start);
  const lastEnd   = new Date(lastStart.getTime() + last.weeks * 7 * 86400000);
  const daysLeft  = _daysBetween(_localMidnight(new Date()), lastEnd);
  if (daysLeft > warnDays) return;
  console.warn(
    `[FiscalCalendar] El último año fiscal configurado (${last.label}) termina el ` +
    `${lastEnd.toLocaleDateString('es-MX')} (en ${daysLeft} dia(s)). Agrega el siguiente ` +
    `FY en FISCAL_YEARS (core/fiscal-calendar.js) antes de esa fecha, o las filas de ese ` +
    `día en adelante se quedan sin SW/DIA.`
  );
}
