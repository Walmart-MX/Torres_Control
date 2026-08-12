/**
 * ui/pulse-bar.js
 * PULSE BAR — sin cambios respecto al original, no está afectado por
 * la integración del Reporte WTMS. Se incluye tal cual para evitar
 * mezcla de versiones.
 */
export const PulseBar = {
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
