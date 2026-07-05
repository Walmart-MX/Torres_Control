/**
 * core/app.js
 * Bootstrap de SmartDispatch — punto de entrada de la aplicación.
 *
 * Responsabilidades:
 *   1. Resolver dependencia circular EditSystem ↔ RoutePicker
 *   2. Aplicar tema y usuario de la sesión anterior
 *   3. Cargar FactCache desde localStorage
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
 * Dependencias: todos los módulos de la aplicación.
 */
import { State } from './state.js';
import { UI } from '../ui/ui.js';
import { Events } from '../events/events.js';
import { EditSystem, _setRoutePicker } from '../editing/edit-system.js';
import { WarnModal } from '../editing/warn-modal.js';
import { RoutePicker } from '../editing/route-picker.js';
import { FactCache } from '../features/fact-cache.js';
import { initCatalog } from '../features/catalog.js';

/**
 * Inicializa la aplicación completa.
 */
export async function init() {
  // ── Resolver dependencia circular EditSystem ↔ RoutePicker ──
  _setRoutePicker(RoutePicker);

  // ── Theme & User ──
  UI.applyTheme(State.theme);
  UI.setUser(State.user);

  // ── Load FactCache from localStorage ──
  State.factCache = FactCache.load();
  const fcStats = FactCache.stats();
  if (fcStats.total > 0) {
    console.log('[FactCache] Loaded', fcStats.total, 'invoices from', fcStats.days, 'day(s):', fcStats.dates.join(', '));
  }

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

  // ── Catalog ──
  // NOTA Camino B / Fase 1: el botón "💾 Guardar" (btnCatSave) se eliminó
  // de index.html — ya no existe un paso manual de persistencia. Cada
  // alta/baja/importación escribe en Supabase al instante (ver Events).
  document.getElementById('catToggle').addEventListener('click', () =>
    document.getElementById('catPanel').classList.toggle('open'));
  document.getElementById('btnCatAdd').addEventListener('click',     () => Events.addCatalogEntry());
  document.getElementById('catLicInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') Events.addCatalogEntry();
  });
  document.getElementById('catImportFile').addEventListener('change', function() {
    Events.importCatalog(this.files[0]); this.value = '';
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

  // ── Init pipeline (visual, no depende del catálogo) ──
  UI.setPipeStep(1, 'active', 'En espera');
  UI.setActionsEnabled(false);
  UI.updateHealthRail();

  // ── Init catalog — Supabase (Camino B, Fase 1) ──
  UI.setCatStatus('Cargando catálogo…', 'ok');
  const catResult = await initCatalog();
  UI.renderCatalog();
  UI.setCatStatus(catResult.msg, catResult.ok ? 'ok' : 'err');

  // ── First-run modal ──
  setTimeout(() => {
    const configured = localStorage.getItem('sd_configured');
    if (!configured) UI.openModal('setup');
  }, 350);
}
