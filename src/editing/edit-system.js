/**
 * editing/edit-system.js
 * EDIT SYSTEM — corrección inline de registros desde las alertas del SVE.
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   Se agregan dos campos editables — '_ID_RETORNO' (label 'ID RETORNO')
 *   y '_CARTA_PORTE' (label 'CARTA PORTE') — para resolver manualmente
 *   el "doble dato" que reporta la regla SVE 'wtms_ambiguous'.
 *   saveAndRevalidate() recalcula row['_wtmsAmbiguous'] cuando se edita
 *   cualquiera de esos dos campos, para que runSVE() ya no lo marque
 *   crítico una vez resuelto.
 *
 * Dependencias:
 *   - State (core/state.js)
 *   - escH (utils/dom.js)
 *   - UI (ui/ui.js)
 *   - runSVE (features/validation/sve.js)
 *   - addOperator (features/catalog.js)
 *   - RoutePicker (editing/route-picker.js) — resuelto vía _setRoutePicker()
 */
import { State } from '../core/state.js';
import { escH } from '../utils/dom.js';
import { UI } from '../ui/ui.js';
import { runSVE } from '../features/validation/sve.js';
import { addOperator } from '../features/catalog.js';
import { normOp } from '../utils/format.js';

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
  { key:'_ID_RETORNO', label:'ID RETORNO',       crit:false },
  { key:'_CARTA_PORTE',label:'CARTA PORTE',      crit:false },
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

  findByRowId(rowId) {
    const idx = State.merged.findIndex(r => r._rowId === rowId);
    if (idx === -1) return null;
    return { row: State.merged[idx], idx };
  },

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

        if (field === '_ID_RETORNO' || field === '_CARTA_PORTE') {
          const stillAmbiguous =
            String(row['_ID_RETORNO']  || '').includes(',') ||
            String(row['_CARTA_PORTE'] || '').includes(',');
          row['_wtmsAmbiguous'] = stillAmbiguous;
        }

        if (field === '_LIC') {
          row['LIC.'] = newVal;

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

    const sveResult = runSVE(State.merged);
    if (sveResult) {
      UI.renderSVE(sveResult.issues, sveResult.quality, sveResult.nCrit, sveResult.nWarn, sveResult.nInfo, sveResult.nPass);
    } else {
      UI.resetSVE();
    }
    UI.updateHealthRail();
    UI.applyMode();
  },

  close() {
    document.getElementById('editDrawer').classList.remove('open');
    setTimeout(() => {
      document.querySelectorAll('.row-highlight').forEach(r => r.classList.remove('row-highlight'));
    }, 800);
    EditSystem._currentRowId = null;
  }
};
