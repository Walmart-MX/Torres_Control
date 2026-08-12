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
 * CAMBIO (rediseño Mesa de Trabajo — mockup jul-2026):
 *   saveAndRevalidate() ahora:
 *     1) pasa screenCount a runSVE() — ver nota "Fix regla K" en
 *        features/validation/sve.js (ya no lee #bdgXLS del DOM);
 *     2) guarda el resultado en State.sveIssues, la misma fuente que
 *        usa UI._buildRowStatusMap() para pintar el status pill
 *        (Completa/Advertencia/Crítica/Corregida) de cada fila;
 *     3) vuelve a llamar UI.renderTable() DESPUÉS de correr el SVE
 *        (antes solo se llamaba una vez, antes de conocer el
 *        resultado del SVE) — así el pill de la fila editada refleja
 *        de inmediato si la corrección resolvió o no la incidencia,
 *        sin esperar a la siguiente acción del usuario.
 *
 * CAMBIO (jul-2026 — regla SVE 'integrity'/K, descuento de exclusiones):
 *   _revalidateAfterEdit() ahora pasa State.excludedCount como tercer
 *   argumento a runSVE() (ver features/validation/sve.js), igual que
 *   Events.triggerMerge() (ver events.js). State.excludedCount ya está
 *   actualizado por la corrida de runMerge() más reciente —
 *   _revalidateAfterEdit() solo re-valida tras una edición, no vuelve
 *   a correr el merge, así que lee el valor correcto sin necesidad de
 *   recalcularlo aquí.
 *
 * CAMBIO (jul-2026 — captura dinámica de hasta 5 marchamos):
 *   Se agrega quickFixMulti(rowIds, fields) — hermano de quickFix()
 *   pero aplica VARIOS campos a la vez con un timestamp compartido
 *   (ver ui.js → _fixCardMarchamo()/MULTI_RULES). Reutiliza
 *   applyFieldEdit() por cada campo, así que la propagación de
 *   licencia y el recálculo de _wtmsAmbiguous (si aplicaran) siguen
 *   siendo el único lugar que los define — sin duplicar lógica.
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

    const tbody     = document.getElementById('mainTbody');
    const tableRows = tbody ? tbody.querySelectorAll('tr') : [];
    tableRows.forEach(r => r.classList.remove('row-highlight'));
    if (tableRows[idx]) {
      tableRows[idx].classList.add('row-highlight');
      tableRows[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const rutaVal  = String(row['RUTA']||'').trim();
// NUEVO (jul-2026): row['DETTE'] viene intacto del Excel (merge.js hace
// nr = {...row, ...}), no requiere getMapped ni import nuevo. Se agrega
// al mismo badge existente — sin tocar index.html ni ningún otro caller.
const detteVal = String(row['DETTE']||'').trim();
document.getElementById('editDrawerRuta').textContent =
  'Ruta ' + rutaVal + (detteVal ? ' · Entrega ' + detteVal : '');
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

  /**
   * Aplica un cambio de campo a una o más filas, con los mismos efectos
   * secundarios que antes vivían solo dentro de saveAndRevalidate():
   * recálculo de _wtmsAmbiguous, propagación de Licencia a todas las
   * entregas del mismo operador + sincronización con el catálogo, y
   * registro en State.edits (auditoría + fuente del status pill
   * "Corregida" en la Mesa de Trabajo).
   *
   * NUEVO (Correcciones — mockup jul-2026): antes esta lógica vivía
   * inline en el forEach de saveAndRevalidate() y solo la usaba el
   * drawer completo. Se extrae aquí para que las tarjetas de
   * "corrección rápida" de Correcciones (un campo, un valor) la
   * reutilicen sin duplicar la propagación de licencia ni el recálculo
   * de WTMS ambiguo — un solo lugar define "qué pasa cuando cambia
   * este campo", sin importar desde qué pantalla se editó.
   *
   * No-op silencioso por fila si newVal es idéntico al valor actual —
   * seguro de llamar aunque el campo no haya cambiado.
   *
   * @param {string[]} rowIds — _rowId de las filas a editar (normalmente 1;
   *   puede ser más de 1 para incidencias de ruta completa, ej. Operador
   *   faltante en varias entregas de la misma ruta)
   * @param {string} field — clave del campo en State.merged (ej. 'OPERADOR', '_LIC', 'TARIMAS')
   * @param {string} newVal
   * @param {{ts?: string}} [opts] — ts opcional para que varios campos de un mismo guardado compartan timestamp
   * @returns {boolean} true si se aplicó al menos un cambio real
   */
  applyFieldEdit(rowIds, field, newVal, opts = {}) {
    const ts = opts.ts || new Date().toLocaleString('es-MX');
    let appliedAny = false;

    (rowIds || []).forEach(rowId => {
      const found = EditSystem.findByRowId(rowId);
      if (!found) { console.warn('[EditSystem] rowId no encontrado al aplicar edición:', rowId); return; }
      const { row } = found;

      const oldVal = String(row[field] || '');
      if (newVal === oldVal) return;
      row[field] = newVal;
      appliedAny = true;

      if (field === '_ID_RETORNO' || field === '_CARTA_PORTE') {
        row['_wtmsAmbiguous'] =
          String(row['_ID_RETORNO']  || '').includes(',') ||
          String(row['_CARTA_PORTE'] || '').includes(',');
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

      State.edits.push({ rowId, ruta: String(row['RUTA']||''), field, oldVal, newVal, ts, user: State.user });
    });

    return appliedAny;
  },

  /**
   * Remate común tras cualquier edición (drawer completo o corrección
   * rápida de Correcciones): re-pinta la tabla, recorre el SVE con el
   * dataset actualizado, guarda State.sveIssues, y vuelve a pintar
   * tanto la Mesa de Trabajo (status pill por fila) como Correcciones
   * (lista de incidencias pendientes) con el resultado fresco.
   * @private
   */
  _revalidateAfterEdit() {
    UI.renderTable();
    UI.updateStats();

    const screenCount = State.xlsData ? State.xlsData.length : 0;
    // CAMBIO (jul-2026): se pasa State.excludedCount, igual que
    // Events.triggerMerge() — ver nota de cabecera de este archivo y
    // de features/validation/sve.js (regla K).
    const sveResult = runSVE(State.merged, screenCount, State.excludedCount);
    if (sveResult) {
      State.sveIssues = sveResult.issues;
      UI.renderSVE(sveResult.issues, sveResult.quality, sveResult.nCrit, sveResult.nWarn, sveResult.nInfo, sveResult.nPass);
    } else {
      State.sveIssues = [];
      UI.resetSVE();
    }
    // El status pill de cada fila, Correcciones, Calidad y Exportación
    // dependen de State.sveIssues, recién actualizado arriba.
    UI.renderTable();
    UI.renderFixList();
    UI.renderQualityScreen();
    UI.renderExportScreen();
    UI.updateHealthRail();
    UI.applyMode();
  },

  /**
   * Punto de entrada de las tarjetas de "corrección rápida" en
   * Correcciones — un campo, un valor, sin abrir el drawer completo.
   * @param {string[]} rowIds
   * @param {string} field
   * @param {string} newVal
   * @returns {boolean} true si se aplicó el cambio
   */
  quickFix(rowIds, field, newVal) {
    const val = String(newVal || '').trim();
    if (!val) return false;
    const applied = EditSystem.applyFieldEdit(rowIds, field, val);
    if (applied) EditSystem._revalidateAfterEdit();
    return applied;
  },

  /**
   * Punto de entrada de la tarjeta de "corrección múltiple" en
   * Correcciones — NUEVO (jul-2026, captura dinámica de hasta 5
   * marchamos, ver ui.js → _fixCardMarchamo()/MULTI_RULES). Hermano de
   * quickFix(), pero aplica VARIOS campos a la vez con un solo
   * timestamp compartido — reutiliza applyFieldEdit() por cada campo,
   * sin duplicar la lógica de propagación/auditoría que ya vive ahí.
   *
   * Campos vacíos se ignoran por completo (nunca llegan a
   * applyFieldEdit) — consistente con "todos los campos son
   * opcionales" del requerimiento de captura de marchamos. Solo se
   * revalida una vez al final, aunque se hayan aplicado varios campos.
   *
   * @param {string[]} rowIds — _rowId de las filas a editar
   * @param {Object<string,string>} fields — { 'MARCHAMO 1': '12345', 'MARCHAMO 2': '67890', ... }
   *   claves = nombre de campo en State.merged, valores = texto capturado por el usuario
   * @returns {boolean} true si se aplicó al menos un cambio real
   */
  quickFixMulti(rowIds, fields) {
    const ts = new Date().toLocaleString('es-MX');
    let appliedAny = false;
    Object.entries(fields || {}).forEach(([field, rawVal]) => {
      const val = String(rawVal || '').trim();
      if (!val) return; // campo vacío — se ignora, nunca se envía a applyFieldEdit
      const applied = EditSystem.applyFieldEdit(rowIds, field, val, { ts });
      if (applied) appliedAny = true;
    });
    if (appliedAny) EditSystem._revalidateAfterEdit();
    return appliedAny;
  },

  saveAndRevalidate() {
    if (!EditSystem._currentRowId) return;

    const found = EditSystem.findByRowId(EditSystem._currentRowId);
    if (!found) { console.warn('[EditSystem] Row disappeared before save:', EditSystem._currentRowId); return; }

    const inputs = document.getElementById('editFieldsGrid').querySelectorAll('.edit-field-input');
    const ts     = new Date().toLocaleString('es-MX');

    inputs.forEach(inp => {
      const field  = inp.dataset.field;
      const newVal = inp.value.trim();
      EditSystem.applyFieldEdit([EditSystem._currentRowId], field, newVal, { ts });
    });

    EditSystem.close();
    EditSystem._revalidateAfterEdit();
  },

  close() {
    document.getElementById('editDrawer').classList.remove('open');
    setTimeout(() => {
      document.querySelectorAll('.row-highlight').forEach(r => r.classList.remove('row-highlight'));
    }, 800);
    EditSystem._currentRowId = null;
  }
};
