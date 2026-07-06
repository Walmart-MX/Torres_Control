/**
 * events/events.js
 * EVENTS — coordinador central de todos los manejadores de eventos.
 *
 * Este objeto actúa como la capa de orquestación: recibe eventos del DOM
 * (clicks, drops, cambios de input) y coordina las llamadas a los módulos
 * de procesamiento, estado y UI. No contiene lógica de negocio propia.
 *
 * CAMBIO Camino B / Fase 1: las funciones de catálogo (addCatalogEntry,
 * delOp, importCatalog) pasaron de síncronas a async — ahora persisten
 * en Supabase antes de refrescar la UI, en vez de mutar únicamente el
 * Map en memoria. El contrato con quien las invoca no cambió: siguen
 * llamándose igual, solo que ahora devuelven una Promise (el caller no
 * necesita await si no le importa esperar el resultado, ver renderCatalog
 * en ui.js, que las invoca en un onclick inline sin await).
 *
 * Dependencias:
 *   - State (core/state.js)
 *   - normOp (utils/format.js)
 *   - UI (ui/ui.js)
 *   - EditSystem, WarnModal, RoutePicker (editing/)
 *   - FactCache (features/fact-cache.js)
 *   - pdfExtract, parsePDF (processors/pdf.js)
 *   - processXLS (processors/excel.js)
 *   - processPaste (processors/paste.js)
 *   - runMerge (processors/merge.js)
 *   - runSVE (features/validation/sve.js)
 *   - exportXLSX (features/export.js)
 *   - addOperator, deleteOperator, importOperators (features/catalog.js)
 *   - XLSX (global del CDN — usado en importCatalog)
 */
import { State } from '../core/state.js';
import { normOp } from '../utils/format.js';
import { UI } from '../ui/ui.js';
import { EditSystem } from '../editing/edit-system.js';
import { WarnModal } from '../editing/warn-modal.js';
import { RoutePicker } from '../editing/route-picker.js';
import { FactCache } from '../features/fact-cache.js';
import { pdfExtract, parsePDF } from '../processors/pdf.js';
import { processXLS } from '../processors/excel.js';
import { processPaste } from '../processors/paste.js';
import { runMerge } from '../processors/merge.js';
import { runSVE } from '../features/validation/sve.js';
import { exportXLSX } from '../features/export.js';
import { addOperator, deleteOperator, importOperators } from '../features/catalog.js';

export const Events = {

  // ── Drop zones ──
  setupDrop(zoneId, inputId, handler) {
    const zone  = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', ()=> zone.classList.remove('drag'));
    zone.addEventListener('drop',      e => { e.preventDefault(); zone.classList.remove('drag'); handler([...e.dataTransfer.files]); });
    input.addEventListener('change',   ()=> { handler([...input.files]); input.value = ''; });
  },

  // ── PDF handler ──
  async handlePDFs(files) {
    files = files.filter(f => f.type === 'application/pdf');
    if (!files.length) return;
    UI.showProgress('Procesando PDFs…');
    const errors = [];
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        const extracted = await pdfExtract(files[i]);
        const parsed    = parsePDF(extracted, files[i].name);
        for (const r of parsed) {
          State.pdfData.set(r.ruta + '|' + r.factura,   r);
          State.pdfData.set(r.ruta + '|D|' + r.destino, r);
        }
        if (parsed.length) ok++;
        else errors.push('Sin datos: ' + files[i].name);
      } catch (e) { errors.push('Error: ' + files[i].name + ' — ' + e.message); }
      UI.setProgress(i + 1, files.length, files[i].name);
    }
    UI.hideProgress();

    const uniqueCount = new Set([...State.pdfData.keys()].filter(k => !k.includes('|D|'))).size;
    UI.setBadge('pdfBadge', `✓ ${ok} archivos · ${uniqueCount} entregas`, 'done');
    UI.setDZDone('dropPDF', `${ok} archivos cargados`);
    UI.setPipeStep(1, 'done', `${uniqueCount} entregas`);
    document.getElementById('pipeNum1').textContent = '✓';

    if (errors.length) UI.showErrors(errors);
    UI.setActionsEnabled(true);
    Events.triggerMerge();
  },

  // ── XLS handler ──
  async handleXLS(files) {
    const file = files.find(f => f.name.match(/\.xlsx?$/i));
    if (!file) return;
    UI.showProgress('Leyendo Excel…');
    try {
      const { rows, factData, ruteoName, factSheetLabel } = await processXLS(file);
      State.xlsData  = rows;
      State.factData = factData;

      // cacheUpdating: refleja el estado en el panel "Historial de caché".
      // persist() hoy es síncrono (localStorage), así que la ventana es
      // casi instantánea — queda listo para cuando fact_cache migre a
      // Supabase en Camino B Fase 2, donde sí habrá una espera real.
      State.cacheUpdating = true;
      UI.renderCacheHistory();
      FactCache.persist(factData);
      State.cacheUpdating = false;
      UI.renderCacheHistory();

      UI.setBadge('xlsBadge', `✓ ${rows.length} rutas · ${factSheetLabel}`, 'done');
      UI.setDZDone('dropXLS', file.name);
      UI.setPipeStep(2, 'done', `${rows.length} rutas`);
      document.getElementById('pipeNum2').textContent = '✓';
      document.getElementById('bdgXLS').textContent   = rows.length;

      UI.hideProgress();
      UI.setActionsEnabled(true);
      Events.triggerMerge();
    } catch (e) {
      UI.hideProgress();
      UI.showErrors([e.message]);
    }
  },

  // ── Paste handler ──
  handlePaste() {
    const raw = document.getElementById('pasteArea').value.trim();
    if (!raw) { UI.setPasteSt('Pega datos primero', 'err'); return; }
    UI.setPasteSt('Procesando…', 'proc');
    try {
      const { data, preview, idx } = processPaste(raw);
      State.despData = data;
      document.getElementById('bdgDesp').textContent = data.size;
      UI.setPasteSt(`✓ ${data.size} rutas detectadas`, 'ok');
      UI.setPipeStep(3, 'done', `${data.size} rutas`);
      document.getElementById('pipeNum3').textContent = '✓';
      if (preview.length) UI.renderPastePreview(preview, idx);
      Events.triggerMerge();
    } catch (e) {
      UI.setPasteSt(e.message, 'err');
    }
  },

  clearPaste() {
    document.getElementById('pasteArea').value = '';
    document.getElementById('pastePreview').classList.remove('on');
    State.despData = new Map();
    document.getElementById('bdgDesp').textContent = '0';
    UI.setPasteSt('', '');
    UI.setPipeStep(3, 'optional', 'Opcional');
    document.getElementById('pipeNum3').textContent = '·';
    Events.triggerMerge();
  },

  // ── Merge + SVE trigger ──
  triggerMerge() {
    if (!State.xlsData || State.pdfData.size === 0) return;
    runMerge();
    UI.renderTable();
    UI.updateStats();
    UI.setActionsEnabled(true);
    setTimeout(() => {
      const sveResult = runSVE(State.merged);
      if (sveResult) {
        UI.renderSVE(sveResult.issues, sveResult.quality, sveResult.nCrit, sveResult.nWarn, sveResult.nInfo, sveResult.nPass);
      } else {
        UI.resetSVE();
      }
      UI.updateHealthRail();
    }, 100);
  },

  // ── Export ──
  // Tres ramas según el estado del SVE:
  //   critical  → flash del gate, no exporta
  //   warn-only → muestra WarnModal para confirmar
  //   clean     → exporta directamente
  handleExport() {
    if (State.sveHasCritical) {
      document.getElementById('svePanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      const gate = document.getElementById('exportGate');
      gate.style.opacity = '.3';
      setTimeout(() => gate.style.opacity = '1', 200);
      return;
    }
    if (!State.merged.length) return;
    if (State.sveHasWarnings) {
      WarnModal.show();
      return;
    }
    exportXLSX();
  },

  handleForceExport() {
    const ts   = new Date().toLocaleString('es-MX');
    const user = State.user || 'desconocido';
    const nc   = parseInt(document.getElementById('sveCrit').textContent || '0', 10);
    State.sveAuditLog.push({ ts, user, action:'FORCE_EXPORT', quality:State.sveLastQuality, critErrors:nc });
    console.warn('[SVE AUDIT] Exportación forzada:', State.sveAuditLog[State.sveAuditLog.length-1]);

    document.getElementById('btnExport').disabled  = false;
    document.getElementById('btnExport2').disabled = false;
    const gate = document.getElementById('exportGate');
    gate.classList.add('forced');
    gate.innerHTML = `<div class="gate-msg"><strong style="color:var(--orange)">⚠ Exportación forzada registrada</strong><span>${ts} · ${user} · Calidad: ${State.sveLastQuality}% · ${nc} error${nc>1?'es':''} crítico${nc>1?'s':''}.</span></div>`;
    exportXLSX();
  },

  // ── Catalog (Camino B / Fase 1 — Supabase) ──
  async addCatalogEntry() {
    const op  = document.getElementById('catOpInput').value.trim();
    const lic = document.getElementById('catLicInput').value.trim();
    if (!op || !lic) { UI.setCatStatus('Completa ambos campos', 'err'); return; }
    UI.setCatStatus('Guardando…', 'ok');
    const result = await addOperator(op, lic);
    document.getElementById('catOpInput').value  = '';
    document.getElementById('catLicInput').value = '';
    document.getElementById('catOpInput').focus();
    UI.renderCatalog();
    UI.setCatStatus(result.msg, result.cls);
    if (result.ok && State.merged.length) Events.triggerMerge();
  },

  async delOp(op) {
    UI.setCatStatus('Eliminando…', 'ok');
    const result = await deleteOperator(op);
    UI.renderCatalog();
    UI.setCatStatus(result.msg, result.cls);
    if (result.ok && State.merged.length) Events.triggerMerge();
  },

  async importCatalog(file) {
    if (!file) return;
    UI.setCatStatus('Importando…', 'ok');
    try {
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const keys = Object.keys(rows[0] || {});
      const kOp  = keys.find(k => /OPER|NOMBRE|NAME/i.test(k)) || keys[0];
      const kLic = keys.find(k => /LIC/i.test(k)) || keys[1];
      const entries = rows
        .map(r => ({ op: String(r[kOp] || '').trim(), lic: String(r[kLic] || '').trim() }))
        .filter(e => e.op && e.lic);

      const result = await importOperators(entries);
      UI.renderCatalog();
      UI.setCatStatus(result.msg, result.cls);
      if (result.ok && State.merged.length) Events.triggerMerge();
    } catch (e) { UI.setCatStatus('Error: ' + e.message, 'err'); }
  }
};
