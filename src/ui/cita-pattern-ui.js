/**
 * ui/cita-pattern-ui.js
 * CITA PATTERN UI — pinta la lista de variantes de cita activas en
 * Administración → Centro de Mantenimiento → "Variantes de Cita". Se
 * mantiene FUERA de ui.js (100KB+) a propósito — mismo criterio de
 * cohesión que editing/warn-modal.js o editing/route-picker.js: un
 * widget autocontenido con su propio render, sin lógica de negocio
 * (eso vive en events.js / cita-pattern-store.js). ui.js solo delega
 * aquí vía dos métodos finos (renderCitaPatterns/setCitaPatternStatus).
 *
 * Dependencias:
 *   - escH (utils/dom.js) — mismo helper de escape que usa ui.js
 *   - sampleCitaText (features/citas/cita-pattern-registry.js) — vista
 *     previa en vivo del formato configurado, sin que el operador
 *     tenga que leer ni escribir una regex.
 */
import { escH } from '../utils/dom.js';
import { sampleCitaText } from '../features/citas/cita-pattern-registry.js';

const ORDER_LABELS = { DMY: 'Día/Mes/Año', MDY: 'Mes/Día/Año', YMD: 'Año/Mes/Día' };

/**
 * Pinta la tabla de variantes activas.
 * @param {Array<object>} patterns — State.citaPatterns
 */
export function renderCitaPatterns(patterns) {
  const tbody = document.getElementById('citaPatternTbody');
  if (!tbody) return;
  if (!patterns || !patterns.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="cat-empty">Sin variantes adicionales — solo se usa el formato estándar (DD/MM/AAAA o DD-MM-AAAA).</div></td></tr>';
    return;
  }
  tbody.innerHTML = patterns.map(p => `
    <tr>
      <td>${escH(p.label || ORDER_LABELS[p.date_order] || p.date_order)}</td>
      <td><code>${escH(sampleCitaText(p))}</code></td>
      <td title="${escH(p.example_text || '')}">${escH(p.example_text || '—')}</td>
      <td><button class="btn btn-ghost btn-xs" data-cita-pattern-delete="${escH(p.id)}">Quitar</button></td>
    </tr>`).join('');
}

/** Escribe un mensaje de estado en el panel de Variantes de Cita. */
export function setCitaPatternStatus(msg, cls) {
  const el = document.getElementById('citaPatternStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = 'cat-status' + (cls ? ' ' + cls : '');
}
