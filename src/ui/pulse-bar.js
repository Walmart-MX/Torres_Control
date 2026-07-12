/**
 * ui/pulse-bar.js
 * PULSE BAR — Fase 1 del rediseño "Centro de Operaciones" (ver documento
 * de rediseño estratégico). Sustituye tres piezas que hoy repetían la
 * misma información con estilos distintos: el Health Rail del topbar,
 * la franja de 4 stat-cells, y el header (shield/ring/contadores) del
 * panel SVE. Única fuente de verdad visual de "¿cómo va el día?".
 *
 * ALCANCE DE ESTA FASE: la PulseBar es informativa únicamente — no
 * filtra ni prioriza rutas todavía (eso llega en una fase futura,
 * cuando exista el Feed de Atención). El único punto de interacción
 * hoy es el listener de click registrado en core/app.js, que hace
 * scroll y expande el panel SVE si está visible.
 *
 * CAMBIO — Fase 5 del rediseño (ModeSurface / operationalMode): el
 * estado "sin rutas todavía" ya no es un único mensaje genérico — se
 * distingue 'arranque' (nada cargado) de 'triage' (algo cargado, el
 * merge todavía no corrió), reflejando State.operationalMode. El resto
 * del render no cambia.
 *
 * Nota de diseño: el wireframe del documento de rediseño muestra una
 * barra "segmentada" (un punto por ruta). Eso requiere la granularidad
 * por ruta que todavía no existe en la UI (llega con el Feed de
 * Atención) — con cientos de rutas, un punto por ruta tampoco sería
 * legible. Por eso esta fase usa una barra de progreso continua
 * (% de cobertura) coloreada por severidad — mismo lenguaje visual,
 * complejidad apropiada al alcance real de esta fase.
 *
 * Dependencias: ninguna. Recibe todos los datos como parámetros — no
 * lee State ni sve.js directamente, para no acoplar esta pieza visual
 * a la capa de datos. Quien la orquesta (ui/ui.js) ya tiene esos datos.
 */

export const PulseBar = {
  /**
   * Pinta la PulseBar según el estado agregado del día.
   * @param {object} p
   * @param {number} p.total    — cantidad total de rutas en State.merged
   * @param {number} p.matched  — rutas con match de PDF (cobertura)
   * @param {number} p.quality  — State.sveLastQuality (0-100)
   * @param {number} p.nCrit    — incidencias críticas del SVE
   * @param {number} p.nWarn    — advertencias del SVE
   * @param {string} [p.mode]   — State.operationalMode (Fase 5), solo se
   *                              usa para diferenciar el mensaje idle
   */
  render({ total, matched, quality, nCrit, nWarn, mode }) {
    const bar  = document.getElementById('pulseBar');
    const fill = document.getElementById('pulseFill');
    const text = document.getElementById('pulseText');
    if (!bar || !fill || !text) return;

    if (!total) {
      bar.className   = 'pulse-bar idle';
      fill.style.width = '0%';
      text.textContent = mode === 'triage' ? 'Cargando fuentes…' : 'En espera';
      return;
    }

    const covPct    = Math.round((matched / total) * 100);
    const attention = nCrit + nWarn;

    let tier = 'ok';
    if (nCrit > 0) tier = 'crit';
    else if (nWarn > 0 || covPct < 100) tier = 'warn';

    bar.className    = 'pulse-bar ' + tier;
    fill.style.width = covPct + '%';

    const attnLabel = attention === 0
      ? 'sin incidencias pendientes'
      : `${attention} ruta${attention > 1 ? 's' : ''} requiere${attention > 1 ? 'n' : ''} atención`;

    text.textContent = `${total} ruta${total > 1 ? 's' : ''} · ${attnLabel} · calidad ${quality}%`;
  }
};
