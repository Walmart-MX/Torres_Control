/**
 * editing/warn-modal.js
 * WARN CONFIRM MODAL — se muestra cuando el usuario intenta exportar
 * y el SVE tiene advertencias pero ningún error crítico. Permite revisar
 * las advertencias o exportar directamente asumiendo la responsabilidad.
 *
 * Dependencias:
 *   - State (core/state.js) — lee sveLastQuality y sveAuditLog
 *   - exportXLSX (features/export.js) — llamada cuando el usuario confirma
 *   - UI (ui/ui.js) — para hacer scroll al panel SVE en caso de revisión
 */
import { State } from '../core/state.js';
import { exportXLSX } from '../features/export.js';
import { UI } from '../ui/ui.js';

export const WarnModal = {
  show() {
    const nWarn = parseInt(document.getElementById('sveWarn').textContent || '0', 10);
    document.getElementById('wmTitle').textContent =
      `${nWarn} advertencia${nWarn > 1 ? 's' : ''} pendiente${nWarn > 1 ? 's' : ''}`;
    document.getElementById('wmBody').innerHTML =
      `Las advertencias detectadas por el SVE <strong>no bloquean la exportación</strong>, ` +
      `pero podrían indicar datos incompletos o inconsistentes que deberían revisarse.<br><br>` +
      `Puedes revisar las advertencias ahora o exportar directamente. ` +
      `En cualquier caso, el archivo reflejará el estado actual de los datos.`;
    document.getElementById('warnModalOverlay').classList.remove('hidden');
  },

  close() {
    document.getElementById('warnModalOverlay').classList.add('hidden');
  },

  review() {
    WarnModal.close();
    const svePanel = document.getElementById('svePanel');
    svePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const warnGroup = document.getElementById('sveGrp_ADVERTENCIA');
    if (warnGroup && !warnGroup.classList.contains('open')) {
      warnGroup.classList.add('open');
    }
  },

  exportAnyway() {
    WarnModal.close();
    const ts    = new Date().toLocaleString('es-MX');
    const user  = State.user || 'desconocido';
    const nWarn = parseInt(document.getElementById('sveWarn').textContent || '0', 10);
    State.sveAuditLog.push({
      ts, user,
      action: 'EXPORT_WITH_WARNINGS',
      quality: State.sveLastQuality,
      warnings: nWarn
    });
    console.info('[SVE AUDIT] Exportación con advertencias:', State.sveAuditLog[State.sveAuditLog.length - 1]);
    exportXLSX();
  }
};
