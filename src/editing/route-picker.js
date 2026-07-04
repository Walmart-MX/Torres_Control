/**
 * editing/route-picker.js
 * ROUTE PICKER — selector liviano que aparece cuando una alerta SVE
 * afecta a múltiples filas (ej. marchamo duplicado en dos rutas distintas).
 * Presenta las opciones al usuario y resuelve a un único _rowId antes
 * de abrir el drawer de edición.
 *
 * Dependencias:
 *   - escH (utils/dom.js)
 *   - EditSystem (editing/edit-system.js) — _pick() llama a
 *     EditSystem._openDrawer() una vez que el usuario elige una ruta.
 *     Esta dependencia es simétrica con la que EditSystem tiene hacia
 *     RoutePicker — resuelta en runtime vía _setRoutePicker() para
 *     evitar problemas de inicialización circular.
 */
import { escH } from '../utils/dom.js';
import { EditSystem } from '../editing/edit-system.js';

export const RoutePicker = {
  _focusField: '',

  show(rowIds, focusField, contextLabel) {
    RoutePicker._focusField = focusField || '';

    const marchamo = contextLabel || '';
    document.getElementById('rpTitle').textContent =
      'Selecciona la ruta a corregir';
    document.getElementById('rpSub').textContent =
      marchamo
        ? `El marchamo ${marchamo} aparece en múltiples rutas. ¿Cuál deseas editar?`
        : 'Esta incidencia afecta a múltiples rutas. ¿Cuál deseas editar?';

    const optionsEl = document.getElementById('rpOptions');
    optionsEl.innerHTML = rowIds.map(id => {
      const found = EditSystem.findByRowId(id);
      if (!found) return '';
      const { row } = found;
      const ruta = String(row['RUTA']||'').trim();
      const op   = String(row['OPERADOR']||'').trim() || '—';
      const dest = String(row['DEST_PDF']||row['ENT1']||'').trim();
      return `
        <button class="route-picker-opt" data-rowid="${escH(id)}">
          <div>
            <div class="route-picker-opt-ruta">Ruta ${escH(ruta)}</div>
            <div class="route-picker-opt-sub">${escH(op)}${dest ? ' · ' + escH(dest) : ''}</div>
          </div>
        </button>`;
    }).join('');

    document.getElementById('routePickerOverlay').classList.remove('hidden');
  },

  _pick(rowId) {
    RoutePicker.close();
    EditSystem._openDrawer(rowId, RoutePicker._focusField);
  },

  close() {
    document.getElementById('routePickerOverlay').classList.add('hidden');
    document.getElementById('rpOptions').innerHTML = '';
  }
};
