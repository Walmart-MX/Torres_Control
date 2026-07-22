/**
 * editing/route-picker.js
 * ROUTE PICKER — selector liviano que aparece cuando una alerta SVE
 * afecta a múltiples filas (ej. marchamo duplicado en dos rutas distintas).
 * Presenta las opciones al usuario y resuelve a un único _rowId antes
 * de abrir el drawer de edición.
 *
 * CAMBIO (contexto de localización Ruta+Entrega — jul-2026): cada opción
 * ahora también muestra la entrega (DETTE) de la fila, además de
 * Ruta/Operador/Destino — mismo objetivo que el cambio en sve.js/ui.js:
 * que el usuario identifique exactamente cuál entrega está eligiendo sin
 * tener que adivinar a partir de Ruta + Operador únicamente. Sin cambios
 * en la firma pública de show()/_pick()/close().
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
      const ruta  = String(row['RUTA']||'').trim();
      const dette = String(row['DETTE']||'').trim();
      const op    = String(row['OPERADOR']||'').trim() || '—';
      const dest  = String(row['DEST_PDF']||row['ENT1']||'').trim();
      // Entrega antepuesta al operador — mismo criterio de contexto de
      // localización que sve.js/ui.js: la entrega es lo primero que el
      // usuario necesita para distinguir entre opciones de la misma ruta.
      const subParts = [dette ? `Entrega ${dette}` : '', op, dest].filter(Boolean);
      return `
        <button class="route-picker-opt" data-rowid="${escH(id)}">
          <div>
            <div class="route-picker-opt-ruta">Ruta ${escH(ruta)}</div>
            <div class="route-picker-opt-sub">${escH(subParts.join(' · '))}</div>
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
