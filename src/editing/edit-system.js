/**
 * editing/edit-system.js
 * EDIT SYSTEM — corrección inline de registros desde las alertas del SVE.
 *
 * Arquitectura:
 * - Cada fila del merge lleva un _rowId estable (generado en runMerge).
 * - EditSystem usa _rowId como puntero canónico a State.merged.
 *   Sin búsqueda por índice — sin riesgo de editar la fila equivocada.
 * - Cuando una alerta afecta >1 fila (ej. marchamo duplicado), RoutePicker
 *   muestra un selector antes de abrir el drawer.
 * - Los saves mutan el objeto vivo en State.merged directamente.
 * - Cada save re-ejecuta runSVE() para feedback inmediato.
 *
 * FIX (auditoría post-Camino B):
 *   1. saveAndRevalidate() ya no envuelve el re-render del SVE en un
 *      setTimeout(...,80) — no había ninguna razón técnica para ese
 *      retraso (las escrituras al DOM ya son síncronas) y generaba una
 *      ventana donde el usuario percibía que la advertencia "no se
 *      actualizaba". Ahora runSVE()/renderSVE() se ejecutan en el mismo
 *      tick que el guardado.
 *   2. Cuando el campo corregido es la licencia (_LIC), se sincroniza de
 *      inmediato con el catálogo de Supabase vía addOperator() — alta si
 *      el operador es nuevo, actualización si ya existía. Fire-and-forget
 *      (mismo patrón que FactCache.persist()), no bloquea el refresco de
 *      tabla/SVE mientras se guarda. No requiere cambios de esquema: usa
 *      el mismo addOperator()/tabla `operators` de la Fase 1.
 *
 * Dependencias:
 *   - State (core/state.js)
 *   - escH (utils/dom.js)
 *   - UI (ui/ui.js)
 *   - runSVE (features/validation/sve.js)
 *   - addOperator (features/catalog.js) — sincronización de licencia
 *   - RoutePicker (editing/route-picker.js) — importación cruzada entre
 *     módulos de edición: EditSystem.locateAndEdit() delega a RoutePicker
 *     cuando hay múltiples candidatos. RoutePicker importa EditSystem a su
 *     vez — no es un ciclo real porque JS resuelve módulos circulares en
 *     ES Modules via live bindings, pero documentamos el acoplamiento.
 */
import { State } from '../core/state.js';
import { escH } from '../utils/dom.js';
import { UI } from '../ui/ui.js';
import { runSVE } from '../features/validation/sve.js';
import { addOperator } from '../features/catalog.js';
import { normOp } from '../utils/format.js';


// Importación diferida para evitar inicialización circular:
// RoutePicker también importa EditSystem, así que usamos una referencia
// que se resuelve en tiempo de ejecución (no en tiempo de importación).
// El patrón es seguro en ES Modules — los módulos se resuelven antes de
// ejecutarse, así que para cuando locateAndEdit() se llame, RoutePicker
// ya está completamente inicializado.
let RoutePicker;
export function _setRoutePicker(rp) { RoutePicker = rp; }

/** Campos editables del drawer — campo, etiqueta y si es crítico */
export const EDITABLE_FIELDS = [
  { key:'OPERADOR',    label:'Operador',        crit:true  },
  { key:'TARIMAS',     label:'Tarimas',          crit:true  },
  { key:'_LIC',        label:'Licencia',         crit:false },
  { key:'MARCHAMO 1',  label:'Marchamo 1',       crit:false },
  { key:'MARCHAMO 2',  label:'Marchamo 2',       crit:false },
  { key:'MARCHAMO 3',  label:'Marchamo 3',       crit:false },
  { key:'MARCHAMO 4',  label:'Marchamo 4',       crit:false },
  { key:'MARCHAMO 5',  label:'Marchamo 5',       crit:false },
  { key:'FAC_PDF',     label:'Factura',          crit:false },
  { key:'CITA',        label:'Cita',             crit:false },
  { key:'_HR_DESP',    label:'HR. Despacho',     crit:false },
  { key:'_CASETA',     label:'Salida Caseta',    crit:false },
  { key:'_WTMS',       label:'Usuario WTMS',     crit:false },
  { key:'_GLS',        label:'GLS de Embarque',  crit:false },
  { key:'_HORA_FACT',  label:'Hora Facturación', crit:false },
];

export const EditSystem = {
  _currentRowId: null,
  _originalValues: {},

  // ── Canonical lookup: find the State.merged object by _rowId ──
  // Returns { row, idx } or null. Never falls back to RUTA matching.
  findByRowId(rowId) {
    const idx = State.merged.findIndex(r => r._rowId === rowId);
    if (idx === -1) return null;
    return { row: State.merged[idx], idx };
  },

  // ── Entry point called by the SVE delegation handler ──
  // rowIdsJson: JSON array string from data-locate-ids attribute
  // When there is exactly one candidate → open drawer immediately.
  // When there are multiple → show the route picker first.
  locateAndEdit(ruta, focusField, rowIdsJson) {
    let rowIds = [];
    try { rowIds = JSON.parse(rowIdsJson || '[]'); } catch { rowIds = []; }

    const valid = rowIds.filter(id => State.merged.some(r => r._rowId === id));

    if (valid.length === 0) {
      console.warn('[EditSystem] No rowIds provided; falling back to RUTA match for:', ruta);
      const idx = State.merged.findIndex(r => String(r['RUTA']||'').trim() === String(ruta).trim());
      if (idx === -1) { console.warn('[EditSystem] Row not found for ruta:', ruta); return; }
      EditSystem._openDrawer(State.merged[idx]._rowId, focusField);
    } else if (valid.length === 1) {
      EditSystem._openDrawer(valid[0], focusField);
    } else {
      RoutePicker.show(valid, focusField, ruta);
    }
  },

  // ── Open the edit drawer for a specific rowId ──
  _openDrawer(rowId, focusField) {
    const found = EditSystem.findByRowId(rowId);
    if (!found) { console.warn('[EditSystem] rowId not found in State.merged:', rowId); return; }
    const { row, idx } = found;

    EditSystem._currentRowId   = rowId;
    EditSystem._originalValues = {};

    const tbody     = document.getElementById('tbody');
    const tableRows = tbody.querySelectorAll('tr');
    tableRows.forEach(r => r.classList.remove('row-highlight'));
    if (tableRows[idx]) {
      tableRows[idx].classList.add('row-highlight');
      tableRows[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const rutaVal = String(row['RUTA']||'').trim();
    document.getElementById('editDrawerRuta').textContent = 'Ruta ' + rutaVal;
    document.getElementById('editChangeBadge').style.display = 'none';

    const critFields = new Set(
      focusField ? focusField.split(',').map(f => f.trim()) : []
    );

    const grid = document.getElementById('editFieldsGrid');
    grid.innerHTML = EDITABLE_FIELDS.map(f => {
      const val    = String(row[f.key] || '');
      const isCrit = f.crit || critFields.has(f.label) || critFields.has(f.key);
      EditSystem._originalValues[f.key] = val;
      return `
        <div class="edit-field">
          <label class="edit-field-label${isCrit && !val ? ' crit' : ''}" for="ef_${f.key}">
            ${f.label}${isCrit && !val ? ' ⚠' : ''}
          </label>
          <input
            class="edit-field-input${isCrit && !val ? ' field-crit' : ''}"
            id="ef_${f.key}"
            data-field="${f.key}"
            value="${escH(val)}"
            placeholder="${f.label}…"
            autocomplete="off"
          >
        </div>`;
    }).join('');

    grid.querySelectorAll('.edit-field-input').forEach(inp => {
      inp.addEventListener('input', EditSystem._onFieldChange);
    });

    document.getElementById('editDrawer').classList.add('open');

    const firstCrit = grid.querySelector('.field-crit');
    if (firstCrit) firstCrit.focus();
    else grid.querySelector('.edit-field-input')?.focus();
  },

  _onFieldChange() {
    const inputs = document.getElementById('editFieldsGrid').querySelectorAll('.edit-field-input');
    let changed = 0;
    inputs.forEach(inp => {
      if (inp.value !== (EditSystem._originalValues[inp.dataset.field] || '')) changed++;
    });
    const badge = document.getElementById('editChangeBadge');
    if (changed > 0) {
      badge.style.display = '';
      badge.textContent   = changed + ' campo' + (changed > 1 ? 's' : '') + ' modificado' + (changed > 1 ? 's' : '');
    } else {
      badge.style.display = 'none';
    }
  },

  saveAndRevalidate() {
    if (!EditSystem._currentRowId) return;

    const found = EditSystem.findByRowId(EditSystem._currentRowId);
    if (!found) { console.warn('[EditSystem] Row disappeared before save:', EditSystem._currentRowId); return; }
    const { row } = found;

    const inputs = document.getElementById('editFieldsGrid').querySelectorAll('.edit-field-input');
    const ts     = new Date().toLocaleString('es-MX');

    inputs.forEach(inp => {
      const field  = inp.dataset.field;
      const newVal = inp.value.trim();
      const oldVal = EditSystem._originalValues[field] || '';
      if (newVal !== oldVal) {
        row[field] = newVal;
        if (field === '_LIC') {
          row['LIC.'] = newVal;

          // FIX: la licencia es un atributo del OPERADOR, no de la
          // entrega — un mismo operador puede tener varias entregas en
          // la misma corrida. Antes había que repetir la corrección
          // entrega por entrega. Ahora se propaga a todas las filas de
          // State.merged cuyo OPERADOR normalizado coincida, en la
          // misma corrida actual (no requiere recargar ni reprocesar).
          const opNorm = normOp(row['OPERADOR'] || '');
          let propagated = 0;
          if (opNorm) {
            State.merged.forEach(r => {
              if (r === row) return;
              if (normOp(r['OPERADOR'] || '') === opNorm && r['_LIC'] !== newVal) {
                r['_LIC'] = newVal;
                r['LIC.'] = newVal;
                propagated++;
              }
            });
          }
          if (propagated) console.log(`[EditSystem] Licencia propagada a ${propagated} entrega(s) adicional(es) del mismo operador.`);

          // Camino B — sincroniza la licencia corregida con el catálogo
          // de Supabase: alta si el operador es nuevo, actualización si
          // ya existía. Depende de que OPERADOR ya esté resuelto en este
          // mismo row — como OPERADOR aparece antes que _LIC en
          // EDITABLE_FIELDS, si ambos se editan a la vez, row['OPERADOR']
          // ya refleja el valor nuevo para cuando llegamos aquí.
          const opName = String(row['OPERADOR'] || '').trim();
          if (opName && newVal) {
            addOperator(opName, newVal).then(result => {
              UI.renderCatalog();
              if (!result.ok) console.warn('[EditSystem] No se pudo sincronizar la licencia con el catálogo:', result.msg);
            });
          }
        }
        State.edits.push({
          rowId: EditSystem._currentRowId,
          ruta:  String(row['RUTA']||''),
          field, oldVal, newVal, ts,
          user:  State.user
        });
      }
    });

    EditSystem.close();
    UI.renderTable();
    UI.updateStats();

    // FIX: se elimina el setTimeout(...,80) previo — no aportaba nada
    // funcional (el DOM ya está listo en este punto) y solo introducía
    // una ventana donde el usuario podía percibir que la corrección "no
    // se reflejaba".
    const sveResult = runSVE(State.merged);
    if (sveResult) {
      UI.renderSVE(sveResult.issues, sveResult.quality, sveResult.nCrit, sveResult.nWarn, sveResult.nInfo, sveResult.nPass);
    } else {
      UI.resetSVE();
    }
    UI.updateHealthRail();
  },

  close() {
    document.getElementById('editDrawer').classList.remove('open');
    setTimeout(() => {
      document.querySelectorAll('.row-highlight').forEach(r => r.classList.remove('row-highlight'));
    }, 800);
    EditSystem._currentRowId = null;
  }
};
