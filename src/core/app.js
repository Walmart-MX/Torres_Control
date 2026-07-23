/**
 * core/app.js
 * Bootstrap de SmartDispatch — punto de entrada de la aplicación.
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   Se agrega el wiring del dropzone #dropWTMS/#fileWTMS →
 *   Events.handleWTMS(). El pipeline pasa de 3 a 4 pasos — ninguno
 *   "optional" ya (Status y WTMS son obligatorios). El gate de fuentes
 *   faltantes (UI.renderSourceGate) se muestra la primera vez que el
 *   usuario cargue cualquier fuente, vía Events.triggerMerge().
 *
 * Dependencias: todos los módulos de la aplicación.
 */
import { State } from './state.js';
import { UI, _setEvents } from '../ui/ui.js';
import { Events } from '../events/events.js';
import { EditSystem, _setRoutePicker } from '../editing/edit-system.js';
import { WarnModal, _setEvents as _setWarnModalEvents } from '../editing/warn-modal.js';
import { RoutePicker } from '../editing/route-picker.js';
import { FactCache } from '../features/fact-cache.js';
import { initCatalog } from '../features/catalog.js';
import { DispatchHistory } from '../features/dispatch-history.js';
import { CatalogStore } from '../features/catalogs/catalog-store.js';

/**
 * Inicializa la aplicación completa.
 */
export async function init() {
  // ── Resolver dependencias circulares ──
  _setRoutePicker(RoutePicker);
  _setEvents(Events);
  _setWarnModalEvents(Events);

  // ── Theme & User ──
  UI.applyTheme(State.theme);
  UI.setUser(State.user);

  // ── Load FactCache from Supabase (Camino B, Fase 2) ──
  State.factCache    = await FactCache.load();
  State.factCacheLog = await FactCache.loadLog();
  const fcStats = FactCache.stats();
  if (fcStats.total > 0) {
    console.log('[FactCache] Loaded', fcStats.total, 'invoices from', fcStats.days, 'day(s):', fcStats.dates.join(', '));
  }
  UI.renderCacheHistory();

  // ── Drop zones ──
  Events.setupDrop('dropPDF', 'filePDF', Events.handlePDFs.bind(Events));
  Events.setupDrop('dropXLS', 'fileXLS', Events.handleXLS.bind(Events));
  // NUEVO — Reporte WTMS (4ª fuente obligatoria)
  Events.setupDrop('dropWTMS', 'fileWTMS', Events.handleWTMS.bind(Events));

  // ── Buttons ──
  document.getElementById('btnParse').addEventListener('click',      () => Events.handlePaste());
  document.getElementById('btnPasteClear').addEventListener('click', () => Events.clearPaste());
  document.getElementById('btnExport').addEventListener('click',     () => Events.handleExport());
  document.getElementById('btnExport2').addEventListener('click',    () => Events.handleExport());
  document.getElementById('btnAddPDF').addEventListener('click',     () => document.getElementById('filePDF').click());
  document.getElementById('btnClear').addEventListener('click',      () => UI.resetAll());

  // ── Theme toggle ──
  document.getElementById('btnTheme').addEventListener('click', () =>
    UI.applyTheme(State.theme === 'dark' ? 'light' : 'dark'));

  // ── Modal — theme options ──
  document.querySelectorAll('.theme-opt[data-theme]').forEach(el => {
    el.addEventListener('click', () => UI.applyTheme(el.dataset.theme));
  });

  // ── User chip ──
  document.getElementById('tbUser').addEventListener('click', () => UI.openModal('settings'));

  // ── Modal save button ──
  document.getElementById('nameModalBtn').addEventListener('click', () => {
    const name = document.getElementById('nameInput').value.trim() || State.user;
    UI.closeModal(name);
  });

  // ── Enter key en name input ──
  document.getElementById('nameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('nameModalBtn').click();
  });

  // ── Pulse Bar ──
  document.getElementById('pulseBar').addEventListener('click', () => {
    const svePanel = document.getElementById('svePanel');
    if (svePanel.classList.contains('on')) {
      svePanel.classList.add('expanded');
      svePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // ── SVE — barra de resumen colapsable ──
  document.getElementById('sveSummaryToggle').addEventListener('click', () =>
    document.getElementById('svePanel').classList.toggle('expanded'));

  // ── Datos de referencia ──
  document.getElementById('refToggle').addEventListener('click', () =>
    document.getElementById('refPanel').classList.toggle('open'));
  document.getElementById('refTabs').addEventListener('click', e => {
    const tabBtn = e.target.closest('.ref-tab');
    if (!tabBtn) return;
    const tab = tabBtn.dataset.tab;
    document.querySelectorAll('.ref-tab').forEach(b => b.classList.toggle('active', b === tabBtn));
    document.querySelectorAll('.ref-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tabPanel === tab));
  });
  // ── Catálogos Maestros ──
  document.getElementById('masterCatToggle').addEventListener('click', () =>
    document.getElementById('masterCatPanel').classList.toggle('open'));
  document.getElementById('mcVentanaFile').addEventListener('change', function() {
    Events.importMasterCatalog('ventanaRecibo', this.files[0]); this.value = '';
  });
  document.getElementById('mcPoolFile').addEventListener('change', function() {
    Events.importMasterCatalog('poolReal', this.files[0]); this.value = '';
  });

  // ── Catalog ──
  document.getElementById('btnCatAdd').addEventListener('click',     () => Events.addCatalogEntry());
  document.getElementById('catLicInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') Events.addCatalogEntry();
  });
  document.getElementById('catImportFile').addEventListener('change', function() {
    Events.importCatalog(this.files[0]); this.value = '';
  });
  document.getElementById('catTbody').addEventListener('click', e => {
    const btn = e.target.closest('.btn-del');
    if (!btn) return;
    Events.delOp(btn.dataset.delOp);
  });

  // ── Historial de caché ──
  document.getElementById('btnCacheHistClear').addEventListener('click', async () => {
    if (!confirm('¿Eliminar todo el caché histórico de facturas? Esta acción no se puede deshacer.')) return;
    await FactCache.clear();
    await FactCache.clearLog();
    UI.renderCacheHistory();
  });

  // ── SVE "Localizar y corregir" ──
  document.getElementById('sveAlerts').addEventListener('click', e => {
    const btn = e.target.closest('.btn-locate');
    if (!btn) return;
    EditSystem.locateAndEdit(
      btn.dataset.locateRuta,
      btn.dataset.locateField,
      btn.dataset.locateIds || '[]'
    );
  });

  // ── Warn Confirm Modal ──
  document.getElementById('wmReview').addEventListener('click', () => WarnModal.review());
  document.getElementById('wmExport').addEventListener('click', () => WarnModal.exportAnyway());
  document.getElementById('warnModalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('warnModalOverlay')) WarnModal.close();
  });

  // ── Route Picker ──
  document.getElementById('rpOptions').addEventListener('click', e => {
    const opt = e.target.closest('.route-picker-opt');
    if (!opt) return;
    RoutePicker._pick(opt.dataset.rowid);
  });
  document.getElementById('rpCancel').addEventListener('click', () => RoutePicker.close());
  document.getElementById('routePickerOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('routePickerOverlay')) RoutePicker.close();
  });

  // ── Edit drawer ──
  document.getElementById('btnEditSave').addEventListener('click',   () => EditSystem.saveAndRevalidate());
  document.getElementById('btnEditCancel').addEventListener('click', () => EditSystem.close());
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { EditSystem.close(); WarnModal.close(); RoutePicker.close(); }
  });

  // ── Historial de Procesamientos ──
  document.getElementById('btnHistoryOpen').addEventListener('click', () => Events.openHistory());
  document.getElementById('btnHistoryClose').addEventListener('click', () =>
    document.getElementById('historyModalOverlay').classList.add('hidden'));
  document.getElementById('historyModalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('historyModalOverlay')) document.getElementById('historyModalOverlay').classList.add('hidden');
  });
  document.getElementById('historyList').addEventListener('click', e => {
    const item = e.target.closest('[data-session-id]');
    if (!item) return;
    Events.selectHistorySession(item.dataset.sessionId);
  });
  document.getElementById('btnHistoryBack').addEventListener('click', () => {
    document.getElementById('historyListView').style.display = '';
    document.getElementById('historyPreviewView').style.display = 'none';
  });
  document.getElementById('btnHistoryRedownload').addEventListener('click', () => Events.redownloadHistorySession());

  // ── Aviso "día ya procesado" ──
  document.getElementById('btnTodayPreview').addEventListener('click', () => Events.previewTodaySession());
  document.getElementById('btnTodayRedownload').addEventListener('click', () => Events.redownloadToday());

  // ── Init pipeline (visual, no depende del catálogo) ──
  // CAMBIO WTMS: el pipeline pasa de 3 a 4 pasos — ninguno "optional"
  // ya (Status y WTMS son obligatorios ahora). El gate de fuentes
  // faltantes se muestra la primera vez que el usuario cargue
  // cualquier fuente, vía Events.triggerMerge().
  UI.setPipeStep(1, 'active', 'En espera');
  UI.setActionsEnabled(false);
  UI.updateHealthRail();
  UI.applyMode();

  // ── Init catalog — Supabase (Camino B, Fase 1) ──
  UI.setCatStatus('Cargando catálogo…', 'ok');

  const catResult = await initCatalog();

  UI.renderCatalog();
  UI.setCatStatus(catResult.msg, catResult.ok ? 'ok' : 'err');

  // ── Init catálogos maestros (Camino C) ──
  await CatalogStore.loadAll();
  UI.renderCatalogMasterStatus('ventanaRecibo');
  UI.renderCatalogMasterStatus('poolReal');

  // ── Aviso de día ya procesado (Camino B, Fase 3) ──
  const todaySession = await DispatchHistory.getTodaySession();
  State.todaySession = todaySession;
  UI.renderTodayBanner(todaySession);
  UI.applyMode();

  // ── First-run modal ──
  setTimeout(() => {
    const configured = localStorage.getItem('sd_configured');
    if (!configured) UI.openModal('setup');
  }, 350);
}
