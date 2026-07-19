/**
 * events/events.js
 * EVENTS — coordinador central de todos los manejadores de eventos.
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   Ninguna de las 4 fuentes es opcional. Se agrega:
 *     - checkSources() — única fuente de verdad de "¿podemos generar
 *       el archivo final?"
 *     - handleWTMS(files) — nuevo manejador, mismo patrón que handleXLS().
 *       WTMS es catálogo TEMPORAL (State.wtmsData) — no se persiste.
 *     - triggerMerge() reescrito: si checkSources() falla, NUNCA corre
 *       runMerge() — limpia State.merged, pinta el gate de fuentes
 *       faltantes y deshabilita exportación.
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
import { processWTMS } from '../processors/wtms.js';
import { runMerge } from '../processors/merge.js';
import { runSVE } from '../features/validation/sve.js';
import { exportXLSX } from '../features/export.js';
import { addOperator, deleteOperator, importOperators } from '../features/catalog.js';
import { DispatchHistory } from '../features/dispatch-history.js';
import { CatalogStore } from '../features/catalogs/catalog-store.js';

export const Events = {

  setupDrop(zoneId, inputId, handler) {
    const zone  = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', ()=> zone.classList.remove('drag'));
    zone.addEventListener('drop',      e => { e.preventDefault(); zone.classList.remove('drag'); handler([...e.dataTransfer.files]); });
    input.addEventListener('change',   ()=> { handler([...input.files]); input.value = ''; });
  },

  async importMasterCatalog(catalogId, file) {
    if (!file) return;
    UI.setMasterCatStatus('Importando…', 'ok');
    try {
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const result = await CatalogStore.replaceCatalog(catalogId, rows, State.user);
      UI.renderCatalogMasterStatus(catalogId);
      UI.setMasterCatStatus(`✓ ${result.count} registros cargados`, 'ok');
      if (State.merged.length) Events.triggerMerge();
    } catch (e) {
      UI.setMasterCatStatus('Error: ' + e.message, 'err');
    }
  },

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
    Events.triggerMerge();
  },

  async handleXLS(files) {
    const file = files.find(f => f.name.match(/\.xlsx?$/i));
    if (!file) return;
    UI.showProgress('Leyendo Excel…');
    try {
      const { rows, factData, ruteoName, factSheetLabel } = await processXLS(file);
      State.xlsData  = rows;
      State.factData = factData;

      State.cacheUpdating = true;
      UI.renderCacheHistory();
      FactCache.persist(factData).finally(() => {
        State.cacheUpdating = false;
        UI.renderCacheHistory();
      });

      UI.setBadge('xlsBadge', `✓ ${rows.length} rutas · ${factSheetLabel}`, 'done');
      UI.setDZDone('dropXLS', file.name);
      UI.setPipeStep(2, 'done', `${rows.length} rutas`);
      document.getElementById('pipeNum2').textContent = '✓';
      document.getElementById('bdgXLS').textContent   = rows.length;

      UI.hideProgress();
      Events.triggerMerge();
    } catch (e) {
      UI.hideProgress();
      UI.showErrors([e.message]);
    }
  },

  // ── Reporte WTMS handler — NUEVO (4ª fuente obligatoria) ──
  async handleWTMS(files) {
    const file = files.find(f => f.name.match(/\.csv$/i));
    if (!file) { if (files.length) UI.showErrors(['El Reporte WTMS debe ser un archivo .csv']); return; }
    UI.showProgress('Leyendo Reporte WTMS…');
    try {
      const raw = await file.text();
      const { data } = processWTMS(raw);
      State.wtmsData = data;

      UI.setBadge('wtmsBadge', `✓ ${data.size} cargas`, 'done');
      UI.setDZDone('dropWTMS', file.name);
      UI.setPipeStep(4, 'done', `${data.size} cargas`);
      document.getElementById('pipeNum4').textContent = '✓';

      UI.hideProgress();
      Events.triggerMerge();
    } catch (e) {
      UI.hideProgress();
      UI.showErrors([e.message]);
    }
  },

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
    UI.setPipeStep(3, '', 'En espera');
    document.getElementById('pipeNum3').textContent = '3';
    Events.triggerMerge();
  },

  // ── Validación de fuentes obligatorias — NUEVO ──
  checkSources() {
    const missing = [];
    if (State.pdfData.size === 0) missing.push('PDFs de cargas');
    if (!State.xlsData || !State.xlsData.length) missing.push('Excel macro (RUTEO NUEVO)');
    if (State.despData.size === 0) missing.push("Status de despacho (RUTA + ID'S MASTER)");
    if (State.wtmsData.size === 0) missing.push('Reporte WTMS');
    return { ok: missing.length === 0, missing };
  },

  triggerMerge() {
    const { ok, missing } = Events.checkSources();

    if (!ok) {
      State.merged = [];
      UI.renderSourceGate(missing);
      UI.renderTable();
      UI.updateStats();
      UI.resetSVE();
      UI.setActionsEnabled(false);
      UI.updateHealthRail();
      UI.applyMode();
      return;
    }

    UI.renderSourceGate([]);
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
      UI.applyMode();
    }, 100);
  },

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
    Events.finalizeAndExport({ exportType: 'despacho', action: 'clean' });
  },

  handleForceExport() {
    const ts   = new Date().toLocaleString('es-MX');
    const user = State.user || 'desconocido';
    const nc   = parseInt(document.getElementById('sveCrit').textContent || '0', 10);

    document.getElementById('btnExport').disabled  = false;
    document.getElementById('btnExport2').disabled = false;
    const gate = document.getElementById('exportGate');
    gate.classList.add('forced');
    gate.innerHTML = `<div class="gate-msg"><strong style="color:var(--orange)">⚠ Exportación forzada registrada</strong><span>${ts} · ${user} · Calidad: ${State.sveLastQuality}% · ${nc} error${nc>1?'es':''} crítico${nc>1?'s':''}.</span></div>`;

    Events.finalizeAndExport({ exportType: 'despacho', action: 'forced', critErrors: nc });
  },

  async finalizeAndExport(auditMeta = {}) {
    if (!State.merged.length) return;
    const ts   = new Date().toLocaleString('es-MX');
    const user = State.user || 'desconocido';

    State.sveAuditLog.push({ ts, user, action: (auditMeta.action || 'export').toUpperCase(), quality: State.sveLastQuality, ...auditMeta });
    console.info('[SVE AUDIT]', State.sveAuditLog[State.sveAuditLog.length - 1]);

    UI.setExportBusy(true);
    try {
      await DispatchHistory.finalizeSession(State.merged, { ...auditMeta, ts, user });
    } catch (e) {
      console.warn('[DispatchHistory] No se pudo guardar el historial:', e.message);
    }
    UI.setExportBusy(false);

    exportXLSX();
    Events.refreshTodayBanner();
  },

  async refreshTodayBanner() {
    const session = await DispatchHistory.getTodaySession();
    State.todaySession = session;
    UI.renderTodayBanner(session);
    UI.applyMode();
  },

  _historySessions: [],
  _currentHistorySession: null,
  _currentHistoryRows: null,

  async openHistory() {
    document.getElementById('historyModalOverlay').classList.remove('hidden');
    document.getElementById('historyListView').style.display = '';
    document.getElementById('historyPreviewView').style.display = 'none';
    Events._historySessions = await DispatchHistory.listSessions(50);
    UI.renderHistoryList(Events._historySessions);
  },

  async selectHistorySession(sessionId) {
    const session = Events._historySessions.find(s => s.id === sessionId);
    if (!session || session.status !== 'completed') return;
    const rows = await DispatchHistory.getSessionRows(sessionId);
    Events._currentHistorySession = session;
    Events._currentHistoryRows    = rows;
    document.getElementById('historyListView').style.display = 'none';
    document.getElementById('historyPreviewView').style.display = '';
    UI.renderHistoryPreview(rows, session);
  },

  redownloadHistorySession() {
    if (!Events._currentHistoryRows || !Events._currentHistorySession) return;
    exportXLSX(Events._currentHistoryRows, 'despacho', Events._currentHistorySession.session_date);
  },

  async previewTodaySession() {
    const session = await DispatchHistory.getTodaySession();
    if (!session) return;
    document.getElementById('historyModalOverlay').classList.remove('hidden');
    document.getElementById('historyListView').style.display = 'none';
    document.getElementById('historyPreviewView').style.display = '';
    const rows = await DispatchHistory.getSessionRows(session.id);
    Events._currentHistorySession = session;
    Events._currentHistoryRows    = rows;
    UI.renderHistoryPreview(rows, session);
  },

  async redownloadToday() {
    const session = await DispatchHistory.getTodaySession();
    if (!session) return;
    const rows = await DispatchHistory.getSessionRows(session.id);
    exportXLSX(rows, 'despacho', session.session_date);
  },

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
