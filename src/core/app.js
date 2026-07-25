/**
 * core/app.js
 * Bootstrap de SmartDispatch — punto de entrada de la aplicación.
 *
 * CAMBIO (rediseño Preparación / Mesa de Trabajo — mockup jul-2026):
 *   Se agrega el stepper superior (Preparación → Mesa de Trabajo →
 *   Correcciones → Calidad → Exportación) + botón Administración,
 *   fiel al mockup validado por EduarDo. Solo 'prep', 'table' y 'fix'
 *   son pantallas rediseñadas hasta ahora — 'quality'/'export'/'admin'
 *   siguen siendo ALIAS que navegan a 'table' y hacen scroll hasta
 *   #legacyPanel, donde vive lo que aún no tiene pantalla propia
 *   (exportación, catálogos, historial) — sin cambios de comportamiento,
 *   solo de ubicación visual. Cuando esas pantallas se construyan,
 *   LEGACY_ALIASES se reduce entrada por entrada; el resto no cambia.
 *
 *   Se retira el wiring de: pipeline antiguo (#pipeStep1..4 — ya no
 *   existen, reemplazados por las tarjetas de fuente), #btnAddPDF (la
 *   tarjeta de PDF sigue aceptando archivos aunque esté "done", ver
 *   ui.js). Se agrega wiring de: #tableSearch (búsqueda), #filterChips
 *   (delegación de clic en los chips de filtro), #mainTbody (delegación
 *   del botón de editar por fila → EditSystem.locateAndEdit), botón
 *   "Reemplazar archivos" de la vista contraída de Preparación (mismo
 *   handler que antes tenía #btnClear).
 *
 * CAMBIO (rediseño Correcciones — mockup jul-2026):
 *   Se agrega wiring de #fixList/#fixInfoList (delegación de clic en
 *   las tarjetas de corrección rápida ".fix-save" → EditSystem.quickFix,
 *   y de las tarjetas "Revisar" ".fix-review-btn" → mismo mecanismo que
 *   ya usa el panel SVE legacy: EditSystem.locateAndEdit). A diferencia
 *   del botón "Localizar y corregir" del panel legacy (que sí navega a
 *   'table' para que el usuario vea la fila resaltada), el botón
 *   "Revisar" de Correcciones NO cambia de pantalla — el drawer de
 *   edición es un overlay `position:fixed` visible sobre cualquier
 *   pantalla, así que el usuario permanece en Correcciones mientras
 *   corrige. #btnGoQuality (dentro del estado "todo corregido") usa el
 *   mismo alias hacia 'table'/#legacyPanel que el resto de pasos
 *   todavía no rediseñados.
 *
 * CAMBIO (rediseño Calidad — mockup jul-2026):
 *   Calidad sale de LEGACY_ALIASES — tiene pantalla propia con el
 *   Quality Ring. Sin wiring adicional en app.js: los botones "Volver
 *   a Correcciones"/"Continuar a Exportación" del CTA final se generan
 *   dinámicamente en cada renderQualityScreen() (ui.js), porque su
 *   destino depende de si hay errores críticos pendientes — se
 *   enganchan ahí mismo, no aquí.
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

// ── Stepper — navegación entre pantallas ──
const STEPS = [
  { id: 'prep',    label: 'Preparación' },
  { id: 'table',   label: 'Mesa de Trabajo' },
  { id: 'fix',     label: 'Correcciones' },
  { id: 'quality', label: 'Calidad' },
  { id: 'export',  label: 'Exportación' },
];
// Pantallas todavía no rediseñadas — ver nota de cabecera. Alias hacia
// 'table', con scroll a #legacyPanel donde vive la funcionalidad real.
const LEGACY_ALIASES = new Set(['export', 'admin']);
let currentStepIdx = 0;

function renderStepper() {
  const el = document.getElementById('stepper');
  if (!el) return;
  el.innerHTML = STEPS.map((s, i) => {
    const cls = i < currentStepIdx ? 'done' : i === currentStepIdx ? 'active' : '';
    const dotContent = i < currentStepIdx ? '✓' : (i + 1);
    const conn = i < STEPS.length - 1 ? '<div class="step-connector"></div>' : '';
    return `<div class="step ${cls}" data-goto="${s.id}"><div class="step-dot">${dotContent}</div><div class="step-label">${s.label}</div></div>${conn}`;
  }).join('');
  el.querySelectorAll('.step').forEach(elm => elm.addEventListener('click', () => goStep(elm.dataset.goto)));
}

function goStep(id) {
  const targetScreen = LEGACY_ALIASES.has(id) ? 'table' : id;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === targetScreen));

  if (!LEGACY_ALIASES.has(id)) {
    const idx = STEPS.findIndex(s => s.id === id);
    if (idx > -1) currentStepIdx = idx;
    renderStepper();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (LEGACY_ALIASES.has(id)) {
    setTimeout(() => document.getElementById('legacyPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }
}

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

  // ── Stepper ──
  renderStepper();
  document.getElementById('btnAdmin').addEventListener('click', () => goStep('admin'));

  // ── Load FactCache from Supabase (Camino B, Fase 2) ──
  State.factCache    = await FactCache.load();
  State.factCacheLog = await FactCache.loadLog();
  const fcStats = FactCache.stats();
  if (fcStats.total > 0) {
    console.log('[FactCache] Loaded', fcStats.total, 'invoices from', fcStats.days, 'day(s):', fcStats.dates.join(', '));
  }
  UI.renderCacheHistory();

  // ── Drop zones (4 fuentes obligatorias) ──
  Events.setupDrop('dropPDF', 'filePDF', Events.handlePDFs.bind(Events));
  Events.setupDrop('dropXLS', 'fileXLS', Events.handleXLS.bind(Events));
  Events.setupDrop('dropWTMS', 'fileWTMS', Events.handleWTMS.bind(Events));

  // ── Preparación — "Continuar" y "Reemplazar archivos" (vista contraída) ──
  document.getElementById('btnGoTable').addEventListener('click', () => goStep('table'));
  document.getElementById('btnPrepReset').addEventListener('click', () => UI.resetAll());

  // ── Status de despacho (paste) ──
  document.getElementById('btnParse').addEventListener('click',      () => Events.handlePaste());
  document.getElementById('btnPasteClear').addEventListener('click', () => Events.clearPaste());

  // ── Exportación ──
  document.getElementById('btnExport').addEventListener('click',     () => Events.handleExport());
  document.getElementById('btnExport2').addEventListener('click',    () => Events.handleExport());

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

  // ── Mesa de Trabajo — búsqueda y filtros ──
  document.getElementById('tableSearch').addEventListener('input', e => UI.setTableSearch(e.target.value));
  document.getElementById('filterChips').addEventListener('click', e => {
    const btn = e.target.closest('.fchip');
    if (!btn) return;
    UI.setTableFilter(btn.dataset.filter);
  });

  // ── Mesa de Trabajo — botón de editar por fila ──
  document.getElementById('mainTbody').addEventListener('click', e => {
    const btn = e.target.closest('.row-edit-btn');
    if (!btn) return;
    EditSystem.locateAndEdit(btn.dataset.editRuta, '', JSON.stringify([btn.dataset.editRowid]));
  });

  // ── Ir a Correcciones (botón en el header de Mesa de Trabajo) ──
  const btnGoFix = document.getElementById('btnGoFix');
  if (btnGoFix) btnGoFix.addEventListener('click', () => goStep('fix'));

  // ── Correcciones — tarjetas de corrección rápida y "Revisar" ──
  const handleFixCardClick = e => {
    const saveBtn = e.target.closest('.fix-save');
    if (saveBtn) {
      const card  = saveBtn.closest('.fix-card');
      const input = card.querySelector('.fix-input');
      if (!input.value.trim()) { input.focus(); input.classList.add('fix-input-error'); return; }
      const rowIds = JSON.parse(saveBtn.dataset.fixRowids || '[]');
      EditSystem.quickFix(rowIds, saveBtn.dataset.fixKey, input.value);
      return;
    }
    const reviewBtn = e.target.closest('.fix-review-btn');
    if (reviewBtn) {
      EditSystem.locateAndEdit(reviewBtn.dataset.locateRuta, reviewBtn.dataset.locateField, reviewBtn.dataset.locateIds || '[]');
    }
  };
  document.getElementById('fixList').addEventListener('click', handleFixCardClick);
  document.getElementById('fixInfoList').addEventListener('click', handleFixCardClick);

  // ── Correcciones — "Todo corregido" → Dashboard de Calidad (alias) ──
  const btnGoQuality = document.getElementById('btnGoQuality');
  if (btnGoQuality) btnGoQuality.addEventListener('click', () => goStep('quality'));

  // ── SVE — barra de resumen colapsable ──
  document.getElementById('sveSummaryToggle').addEventListener('click', () =>
    document.getElementById('svePanel').classList.toggle('expanded'));

  // ── Catálogos Maestros ──
  document.getElementById('masterCatToggle').addEventListener('click', () =>
    document.getElementById('masterCatPanel').classList.toggle('open'));
  document.getElementById('mcVentanaFile').addEventListener('change', function() {
    Events.importMasterCatalog('ventanaRecibo', this.files[0]); this.value = '';
  });
  document.getElementById('mcPoolFile').addEventListener('change', function() {
    Events.importMasterCatalog('poolReal', this.files[0]); this.value = '';
  });

  // ── Catalog (operadores) ──
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

  // ── Pestañas del panel "Datos de referencia" ──
  document.getElementById('refToggle').addEventListener('click', () =>
    document.getElementById('refPanel').classList.toggle('open'));
  document.getElementById('refTabs').addEventListener('click', e => {
    const tabBtn = e.target.closest('.ref-tab');
    if (!tabBtn) return;
    const tab = tabBtn.dataset.tab;
    document.querySelectorAll('.ref-tab').forEach(b => b.classList.toggle('active', b === tabBtn));
    document.querySelectorAll('.ref-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tabPanel === tab));
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
    goStep('table');
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

  // ── Init visual (no depende del catálogo) ──
  UI.setActionsEnabled(false);
  UI.resetFixPeak();
  UI.resetQualityBaseline();
  UI.updatePrepView(['PDFs de cargas','Excel macro (RUTEO NUEVO)',"Status de despacho (RUTA + ID'S MASTER)",'Reporte WTMS']);
  UI.renderTable();
  UI.renderFixList();
  UI.renderQualityScreen();
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
