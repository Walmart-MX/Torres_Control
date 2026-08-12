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

/**
 * Encuentra a qué año fiscal pertenece una fecha, según FISCAL_YEARS.
 * @param {Date} date — fecha ya normalizada a medianoche local
 * @returns {{label:string, startDate:Date, weeks:number}|null}
 * @private
 */
function _findFiscalYear(date) {
  const sorted = FISCAL_YEARS
    .map(fy => ({ ...fy, startDate: _parseLocalDate(fy.start) }))
    .sort((a, b) => a.startDate - b.startDate);

  for (let i = 0; i < sorted.length; i++) {
    const cur  = sorted[i];
    const next = sorted[i + 1];
    // Si no hay siguiente FY configurado, se asume que este FY dura
    // exactamente `weeks` semanas — cualquier fecha después de eso
    // cae fuera de rango y getFiscalWeek() debe lanzar error explícito.
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
 * @returns {{ fy:string, sw:number, quarter:number, weekStart:Date, weekEnd:Date, totalWeeksInFY:number }}
 * @throws {Error} si la fecha no cae dentro de ningún FY configurado en FISCAL_YEARS
 */
export function getFiscalWeek(dateInput) {
  const date = _localMidnight(dateInput);
  const fy = _findFiscalYear(date);

  if (!fy) {
    throw new Error(
      `No hay año fiscal configurado para la fecha ${date.toLocaleDateString('es-MX')}. ` +
      `Agrega la entrada correspondiente en FISCAL_YEARS (core/fiscal-calendar.js).`
    );
  }

  const daysSinceStart = _daysBetween(fy.startDate, date);
  const weekIndex = Math.floor(daysSinceStart / 7); // 0-based
  const sw = weekIndex + 1;
  const weekStart = new Date(fy.startDate.getTime() + weekIndex * 7 * 86400000);
  const weekEnd   = new Date(weekStart.getTime() + 6 * 86400000);
  const quarter   = Math.min(4, Math.ceil(sw / 13));

  return { fy: fy.label, sw, quarter, weekStart, weekEnd, totalWeeksInFY: fy.weeks };
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
