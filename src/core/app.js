/**
 * core/app.js
 * Bootstrap de SmartDispatch — punto de entrada de la aplicación.
 *
 * Responsabilidades:
 *   1. Resolver dependencias circulares EditSystem ↔ RoutePicker y UI ↔ Events
 *   2. Aplicar tema y usuario de la sesión anterior
 *   3. Cargar FactCache desde localStorage y pintar el panel de diagnóstico
 *      "Historial de caché"
 *   4. Registrar todos los listeners de eventos del DOM
 *   5. Inicializar el catálogo de operadores (Supabase — Camino B, Fase 1)
 *   6. Establecer el estado visual inicial del pipeline
 *   7. Mostrar el modal de bienvenida en el primer uso
 *
 * CAMBIO Camino B / Fase 1: init() ya no recibe el array CATALOG_DATA
 * como parámetro. El catálogo ahora se carga de forma asíncrona desde
 * la tabla `operators` de Supabase (ver features/catalog.js). Por eso
 * init() pasó a ser una función async — el bootstrap en index.html
 * ya no necesita pasarle nada.
 *
 * FIX (dependencia rota desde Fase 9/11 de Camino A): ui.js llama a
 * Events.delOp() y a Events.handleForceExport() pero nunca importaba
 * Events — funcionaba en el monolito porque Events vivía en el scope
 * global del IIFE, y quedó roto silenciosamente al modularizar. Se
 * resuelve con el mismo patrón de setter diferido ya usado entre
 * EditSystem y RoutePicker, para no crear un ciclo de imports estático
 * entre ui.js y events.js (events.js ya importa UI directamente).
 *
 * CAMBIO Fase 1 del rediseño "Centro de Operaciones" (PulseBar): se
 * agrega un único listener nuevo — click en la PulseBar del topbar
 * hace scroll al panel SVE si está visible. Es intencionalmente el
 * único punto de interacción de la PulseBar en esta fase (ver
 * ui/pulse-bar.js — todavía no filtra ni prioriza nada, eso llega con
 * el Feed de Atención en la Fase 3).
 *
 * CAMBIO Fase 2 del rediseño (Datos de referencia): Catálogo de
 * operadores y Caché de facturas eran dos acordeones independientes
 * (catToggle/cacheHistToggle) — se fusionan en un solo panel
 * (refToggle) con pestañas internas (refTabs). Los IDs internos de
 * cada sección (catOpInput, catTbody, cacheHistList, etc.) no
 * cambiaron, así que ningún otro listener de este archivo ni de
 * ui.js/events.js/catalog.js/fact-cache.js necesitó modificarse.
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

  // ── Pulse Bar (Fase 1 del rediseño) ──
  // Único punto de interacción de esta fase: click hace scroll al panel
  // SVE si tiene algo que mostrar (clase 'on'). Si está vacío/oculto no
  // hace nada — no tiene sentido saltar a un panel sin contenido.
  document.getElementById('pulseBar').addEventListener('click', () => {
    const svePanel = document.getElementById('svePanel');
    if (svePanel.classList.contains('on')) {
      svePanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // ── Datos de referencia (Fase 2 del rediseño) ──
  // Panel único con pestañas Catálogo/Caché — reemplaza los dos
  // acordeones separados (catToggle/cacheHistToggle) que existían
  // antes. Un solo listener de apertura + un listener delegado de
  // cambio de pestaña (mismo patrón de delegación ya usado en
  // sveAlerts/catTbody/routePicker más abajo).
  document.getElementById('refToggle').addEventListener('click', () =>
    document.getElementById('refPanel').classList.toggle('open'));
  document.getElementById('refTabs').addEventListener('click', e => {
    const tabBtn = e.target.closest('.ref-tab');
    if (!tabBtn) return;
    const tab = tabBtn.dataset.tab;
    document.querySelectorAll('.ref-tab').forEach(b => b.classList.toggle('active', b === tabBtn));
    document.querySelectorAll('.ref-tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tabPanel === tab));
  });

  // ── Catalog ──
  // NOTA Camino B / Fase 1: el botón "💾 Guardar" (btnCatSave) se eliminó
  // de index.html — ya no existe un paso manual de persistencia. Cada
  // alta/baja/importación escribe en Supabase al instante (ver Events).
  document.getElementById('btnCatAdd').addEventListener('click',     () => Events.addCatalogEntry());
  document.getElementById('catLicInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') Events.addCatalogEntry();
  });
  document.getElementById('catImportFile').addEventListener('change', function() {
    Events.importCatalog(this.files[0]); this.value = '';
  });
  // Botón "✕" de cada fila — antes era onclick inline (Events.delOp(...))
  // referenciando un global que ya no existe tras la modularización.
  // Se reemplaza por delegación, mismo patrón que sveAlerts/routePicker.
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

  // ── SVE "Localizar y corregir" — delegación de eventos ──
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

  // ── Historial de Procesamientos (Camino B, Fase 3) ──
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
  UI.setPipeStep(1, 'active', 'En espera');
  UI.setActionsEnabled(false);
  UI.updateHealthRail();

  // ── Init catalog — Supabase (Camino B, Fase 1) ──
  UI.setCatStatus('Cargando catálogo…', 'ok');
  const catResult = await initCatalog();
  UI.renderCatalog();
  UI.setCatStatus(catResult.msg, catResult.ok ? 'ok' : 'err');

  // ── Aviso de día ya procesado (Camino B, Fase 3) ──
  const todaySession = await DispatchHistory.getTodaySession();
  UI.renderTodayBanner(todaySession);

  // ── First-run modal ──
  setTimeout(() => {
    const configured = localStorage.getItem('sd_configured');
    if (!configured) UI.openModal('setup');
  }, 350);
}
