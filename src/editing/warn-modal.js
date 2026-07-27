/**
 * editing/warn-modal.js
 * WARN CONFIRM MODAL — se muestra cuando el usuario intenta exportar
 * y el SVE tiene advertencias pero ningún error crítico. Permite revisar
 * las advertencias o exportar directamente asumiendo la responsabilidad.
 *
 * FIX (jul-2026): app.js espera resolver la dependencia circular
 * WarnModal ↔ Events vía _setEvents(ev) — mismo patrón ya usado por
 * ui.js (_setEvents) y edit-system.js (_setRoutePicker) — pero este
 * módulo nunca lo implementaba, lo que rompía el import en app.js
 * ("does not provide an export named '_setEvents'"). Se agrega el
 * setter y, de paso, se corrige una inconsistencia real que ese gap
 * escondía: exportAnyway() llamaba a exportXLSX() DIRECTAMENTE en vez
 * de pasar por Events.finalizeAndExport() — las exportaciones "con
 * advertencias confirmadas" nunca quedaban guardadas en el historial
 * de Supabase (DispatchHistory), a diferencia de las rutas "limpia" y
 * "forzada" (Events.handleExport()/handleForceExport()), que sí. Ahora
 * las tres rutas de exportación pasan por el mismo punto único
 * (Events.finalizeAndExport()) — auditoría, persistencia en Supabase,
 * descarga del Excel y el modal de celebración quedan consistentes sin
 * importar por cuál de las tres puertas salió la exportación.
 *
 * NOTA sobre el texto del audit log: antes exportAnyway() empujaba a
 * State.sveAuditLog una acción con el literal 'EXPORT_WITH_WARNINGS'.
 * Ahora usa action:'warned' (mismo estilo terso que 'clean'/'forced'
 * de los otros dos caminos) — cambia el texto guardado en el log, no
 * su función.
 *
 * Dependencias:
 *   - State (core/state.js) — lee sveLastQuality
 *   - UI (ui/ui.js) — para hacer scroll al panel SVE en caso de revisión
 *   - Events (events/events.js) — resuelto en runtime vía _setEvents(),
 *     igual que ui.js resuelve su propia dependencia circular con Events
 */
import { State } from '../core/state.js';
import { UI } from '../ui/ui.js';

let Events;
/** Resuelve la dependencia circular WarnModal ↔ Events — llamado una vez desde core/app.js */
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
    Events.finalizeAndExport({ exportType: 'despacho', action: 'warned', warnings: nWarn, quality: State.sveLastQuality });
  }
};
