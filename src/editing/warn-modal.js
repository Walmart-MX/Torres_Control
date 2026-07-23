/**
 * editing/warn-modal.js
 * WARN CONFIRM MODAL — se muestra cuando el usuario intenta exportar
 * y el SVE tiene advertencias pero ningún error crítico. Permite revisar
 * las advertencias o exportar directamente asumiendo la responsabilidad.
 *
 * CAMBIO Camino B / Fase 3: exportAnyway() ya no llama exportXLSX()
 * directamente ni escribe en State.sveAuditLog por su cuenta — ambas
 * cosas se centralizaron en Events.finalizeAndExport(), que además
 * persiste la sesión en el historial permanente de Supabase (ver
 * features/dispatch-history.js). Como events.js ya importa WarnModal
 * (para handleExport → WarnModal.show()), un import estático de Events
 * aquí crearía un ciclo — se resuelve con el mismo patrón de setter
 * diferido ya usado entre ui.js y events.js.
 *
 * Dependencias:
 *   - UI (ui/ui.js) — para hacer scroll al panel SVE en caso de revisión
 *   - Events (events/events.js) — resuelto en runtime vía _setEvents()
 */
import { UI } from '../ui/ui.js';

let Events;
/** Resuelve la dependencia circular WarnModal ↔ Events — llamado desde core/app.js */
export function _setEvents(ev) { Events = ev; }

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
    const nWarn = parseInt(document.getElementById('sveWarn').textContent || '0', 10);
    Events.finalizeAndExport({ exportType: 'despacho', action: 'warn_confirmed', warnings: nWarn });
  }
};
