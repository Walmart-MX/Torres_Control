/**
 * core/app.js
 * Bootstrap de SmartDispatch — punto de entrada de la aplicación.
 *
 * CAMBIO (rediseño completo — mockup jul-2026, Fases 1-4):
 *   Las 6 pantallas del mockup (Preparación, Mesa de Trabajo,
 *   Correcciones, Calidad, Exportación, Administración) ya tienen
 *   diseño propio — el mecanismo de "alias hacia #legacyPanel" de las
 *   fases anteriores se retira por completo: #legacyPanel ya no existe,
 *   su contenido se redistribuyó a sus pantallas definitivas (ver
 *   índice más abajo). goStep()/renderStepper() vuelven a su forma
 *   simple: togglear .screen y, si el id pertenece a STEPS (los 5
 *   pasos numerados — Administración queda fuera del flujo, se accede
 *   por su propio botón en el topbar), actualizar el indicador.
 *
 *   Dónde quedó cada pieza de #legacyPanel:
 *     - Botón de exportar (antes btnExport/btnExport2 duplicados) →
 *       UN solo #btnExport, ahora el CTA principal de la pantalla
 *       Exportación. btnExport2 se retira (ver ui.js).
 *     - #exportGate (incluye "Exportar de todas formas") → vive
 *       visible dentro de la pantalla Exportación, debajo del stage.
 *     - Resto de #svePanel (resumen/incidencias) → se conserva en el
 *       DOM permanentemente oculto (Correcciones ya cubre esa lista de
 *       forma accionable) — sigue existiendo porque ui.js/events.js/
 *       warn-modal.js leen sus IDs directamente.
 *     - Catálogo de operadores, catálogos maestros, caché de facturas →
 *       pantalla Administración, cada uno en su propia pestaña del
 *       admin-nav (ya no hay acordeones .cat-toggle ni pestañas
 *       .ref-tabs internas — el admin-nav las reemplaza).
 *     - Botón de Historial → sigue en el topbar Y se agrega un acceso
 *       directo en Administración → Historial (mismo Events.openHistory()).
 *
 * CAMBIO (jul-2026 — administración de catálogos maestros fila por fila):
 *   Se agrega wireCatalogAdmin(catalogId, containerId) — delegación de
 *   eventos GENÉRICA (un solo listener por contenedor) para los botones
 *   "+ Agregar"/"✕" que UI.renderCatalogAdmin() genera dinámicamente
 *   dentro de #mcVentanaAdmin/#mcPoolAdmin. No se listean los inputs
 *   individualmente porque UI.renderCatalogAdmin() los reconstruye una
 *   sola vez (guard por dataset.built) — igual patrón que el resto de
 *   la app usa para tablas dinámicas (ver mainTbody/fixList/catTbody).
 *
 * CAMBIO (Centro de Mantenimiento — Fase 2, jul-2026):
 *   El listener de adminNav gana una línea: al entrar al sub-panel
 *   'maint' se dispara Events.loadMaintenanceCenter() — igual criterio
 *   que Historial (Events.openHistory()), que también refresca sus
 *   datos cada vez que se abre en vez de cachear. Se agregan dos
 *   listeners nuevos: resolver una incidencia individual (delegado
 *   sobre #mcOpenTbody, mismo patrón que #catTbody/#mainTbody) y
 *   mostrar/ocultar el histórico de resueltas (#btnMcToggleResolved).
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

/**
 * Navega a cualquiera de las 6 pantallas reales de la app. Si el id
 * pertenece a STEPS (los 5 pasos numerados del flujo operativo), el
 * indicador del stepper se actualiza; Administración ('admin') está
 * fuera de ese flujo — se accede por su propio botón en el topbar y no
 * mueve el indicador de progreso.
 */
function goStep(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === id));
  const idx = STEPS.findIndex(s => s.id === id);
  if (idx > -1) { currentStepIdx = idx; renderStepper(); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Delegación de eventos GENÉRICA para el panel de administración
 * fila-por-fila de un catálogo maestro (Ventana de Recibo / Pool Real).
 * Ver nota de cabecera "CAMBIO (jul-2026 — administración de catálogos
 * maestros fila por fila)". Un solo listener por contenedor cubre tanto
 * el botón "+ Agregar" (data-mc-role="add") como cualquier botón "✕"
 * de eliminar fila (data-mc-del="<uuid>") — ambos regenerados en cada
 * UI.renderCatalogAdmin(catalogId).
 * @param {string} catalogId — 'ventanaRecibo' | 'poolReal'
 * @param {string} containerId — id del contenedor en index.html
 */
function wireCatalogAdmin(catalogId, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.addEventListener('click', e => {
    const addBtn = e.target.closest('[data-mc-role="add"]');
    if (addBtn) {
      const inputs = container.querySelectorAll('[data-mc-field]');
      const values = {};
      inputs.forEach(inp => { values[inp.dataset.mcField] = inp.value.trim(); });
      Events.addCatalogRow(catalogId, values).then(() => {
        // Limpia el formulario solo si el alta fue exitosa — si falló
        // (ej. faltó el índice requerido), el usuario conserva lo ya
        // capturado para corregir sin volver a escribir todo.
        const statusEl = container.querySelector('[data-mc-role="status"]');
        if (statusEl && statusEl.classList.contains('ok')) {
          inputs.forEach(inp => { inp.value = ''; });
        }
      });
      return;
    }
    const delBtn = e.target.closest('[data-mc-del]');
    if (delBtn) {
      const id = delBtn.dataset.mcDel;
      if (!id) return;
      if (!confirm('¿Eliminar este registro del catálogo? Esta acción no se puede deshacer.')) return;
      Events.deleteCatalogRow(catalogId, id);
    }
  });
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
  document.getElementById('btnExport').addEventListener('click', () => Events.handleExport());

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

  // ── Exportación — modal de celebración ──
  document.getElementById('btnCelebrateClose')?.addEventListener('click', () => {
    UI.hideCelebrate();
    goStep('prep');
  });

  // ── Administración — navegación entre sub-paneles (Pool Real,
  // Ventana de Recibo, Licencias, Caché de facturas, Centro de
  // Mantenimiento, Historial, Configuración). Reemplaza los acordeones
  // .cat-toggle y las pestañas .ref-tabs de las fases anteriores — ver
  // nota de cabecera. ──
  document.getElementById('adminNav').addEventListener('click', e => {
    const btn = e.target.closest('.admin-nav-item');
    if (!btn) return;
    document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('active', p.dataset.adminPanel === btn.dataset.admin));
    // Centro de Mantenimiento (Fase 2, jul-2026) — se refresca cada vez
    // que se entra al panel, mismo criterio que Historial
    // (Events.openHistory()): datos pueden haber cambiado desde la
    // última corrida de merge, mejor traerlos frescos que cachear.
    if (btn.dataset.admin === 'maint') Events.loadMaintenanceCenter();
  });
  document.getElementById('mcVentanaFile').addEventListener('change', function() {
    Events.importMasterCatalog('ventanaRecibo', this.files[0]); this.value = '';
  });
  document.getElementById('mcPoolFile').addEventListener('change', function() {
    Events.importMasterCatalog('poolReal', this.files[0]); this.value = '';
  });

  // ── Administración — Ventana de Recibo / Pool Real, alta y baja fila
  // por fila (NUEVO, jul-2026) — ver wireCatalogAdmin() arriba. ──
  wireCatalogAdmin('ventanaRecibo', 'mcVentanaAdmin');
  wireCatalogAdmin('poolReal', 'mcPoolAdmin');

  // ── Administración — Licencias (catálogo de operadores) ──
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

  // ── Administración — Centro de Mantenimiento (Fase 2, jul-2026) ──
  // Resolver una incidencia individual, delegado sobre la tabla —
  // mismo patrón que #catTbody/#mainTbody (las filas se regeneran en
  // cada render, un solo listener en el contenedor cubre todas). ──
  document.getElementById('mcOpenTbody').addEventListener('click', e => {
    const btn = e.target.closest('[data-mc-resolve]');
    if (!btn) return;
    if (!confirm('¿Marcar esta incidencia como resuelta manualmente? Esta acción no se puede deshacer.')) return;
    Events.resolveIncident(btn.dataset.mcResolve);
  });
  document.getElementById('btnMcToggleResolved').addEventListener('click', () => Events.toggleResolvedIncidents());

  // ── Administración — Historial y Configuración (accesos directos;
  // mismo mecanismo que ya usan el ícono 🗂️ y el chip de usuario del
  // topbar, no se duplica lógica) ──
  document.getElementById('btnHistoryOpenAdmin')?.addEventListener('click', () => Events.openHistory());
  document.getElementById('btnOpenSettingsAdmin')?.addEventListener('click', () => UI.openModal('settings'));

  // ── Historial de caché ──
  document.getElementById('btnCacheHistClear').addEventListener('click', async () => {
    if (!confirm('¿Eliminar todo el caché histórico de facturas? Esta acción no se puede deshacer.')) return;
    await FactCache.clear();
    await FactCache.clearLog();
    UI.renderCacheHistory();
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
  UI.renderExportScreen();
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
  // NUEVO (jul-2026): tabla fila-por-fila de cada catálogo maestro —
  // ver ui.js → renderCatalogAdmin().
  UI.renderCatalogAdmin('ventanaRecibo');
  UI.renderCatalogAdmin('poolReal');

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
