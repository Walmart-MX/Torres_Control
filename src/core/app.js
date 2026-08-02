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
 * CAMBIO (jul-2026 — confirmación de entregas sin PDF, "se quedó por
 * ocupación"):
 *   handleFixCardClick() gana un manejo nuevo, ANTES del de
 *   saveBtn/reviewBtn: el botón ".fix-confirm-btn" que
 *   UI._fixCardConfirm() genera para la regla SVE 'dette_sin_pdf' (ver
 *   sve.js). Pide confirmación explícita vía diálogo nativo (la acción
 *   es irreversible una vez exportado: elimina la fila por completo
 *   del Excel final y del historial de Supabase — ver
 *   processors/merge.js) y, si se confirma, delega en
 *   Events.confirmExcludedDette(ruta, dette). Mismo contenedor
 *   (#fixList/#fixInfoList) y mismo listener delegado que ya existía —
 *   no se agrega ningún listener nuevo al DOM, solo una rama más
 *   dentro del handler compartido.
 *
 * CAMBIO (jul-2026 — botón "Continuar a Exportación" tricolor):
 *   Se agrega el listener de #btnFixContinue (ver index.html/ui.js) —
 *   navega a la pantalla Exportación con goStep('export'), mismo
 *   mecanismo que btnGoQuality/btnGoTable. El color/estado del botón
 *   ya lo gobierna UI._updateFixContinueBtn() (llamado desde
 *   renderFixList()); este listener solo maneja la navegación, nunca
 *   bloquea el click — el gate real de exportación sigue viviendo,
 *   sin cambios, en la pantalla Exportación.
 *
 * CAMBIO (jul-2026 — captura dinámica de hasta 5 marchamos):
 *   handleFixCardClick() gana tres manejos nuevos para la tarjeta
 *   .fix-card-marchamo (ver ui.js → _fixCardMarchamo()/MULTI_RULES):
 *   "+ Agregar marchamo" (revela el siguiente input, hasta el máximo
 *   de slots vacíos que trae la tarjeta en data-fix-slots), "✕" por
 *   fila agregada (la quita y reactiva el botón de agregar si estaba
 *   deshabilitado por haber llegado al máximo), y "✓ Guardar" (junta
 *   los valores no vacíos de todos los inputs de la tarjeta y llama a
 *   EditSystem.quickFixMulti()). Los tres viven en el mismo listener
 *   delegado que ya existía sobre #fixList/#fixInfoList — ningún
 *   listener nuevo agregado al DOM. Deliberadamente usan clases CSS
 *   propias (.fix-marchamo-add/.fix-marchamo-remove/.fix-save-
 *   marchamo) distintas de .fix-save/.fix-review-btn para no colisionar
 *   con los checks existentes de esas clases más abajo en el mismo
 *   handler.
 *
 * CAMBIO (jul-2026 — simplificación del flujo, Etapa 4):
 *   Ver nota completa junto a STEPS más abajo. Tres ajustes de
 *   navegación, ninguno de lógica de negocio:
 *     1) El botón de Preparación (id conservado: btnGoTable — el
 *        nombre ya no describe su destino, se documenta aquí en vez de
 *        renombrarlo para minimizar el diff) ahora navega a
 *        goStep('fix') en vez de goStep('table') — el flujo diario
 *        pasa directo de Preparación a Correcciones.
 *     2) El listener de #adminNav gana un chequeo ANTES del toggle de
 *        paneles: cualquier botón con [data-admin-goto] navega
 *        directamente a esa pantalla (goStep) en vez de activar un
 *        sub-panel de Administración — usado por el nuevo acceso
 *        directo a Mesa de Trabajo.
 *     3) Se agrega el listener de #btnGoQualityHeader — mismo destino
 *        (goStep('quality')) que el #btnGoQuality ya existente dentro
 *        del estado vacío de Correcciones; ahora también accesible
 *        siempre, desde la cabecera, sin esperar a que no queden
 *        incidencias pendientes.
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
// CAMBIO (jul-2026 — simplificación del flujo, Etapa 4): STEPS baja de
// 5 a 3 entradas tras varios meses de uso real. Mesa de Trabajo y
// Calidad NO se eliminan — siguen siendo pantallas completas y
// funcionales (ver data-screen="table"/"quality" en index.html,
// goStep() sigue aceptando cualquier id) — solo salen del indicador
// numerado porque en el día a día no aportaban un paso obligatorio:
//   - Mesa de Trabajo: útil para buscar/editar CUALQUIER registro,
//     incluso uno sin incidencias, pero eso es una tarea ocasional, no
//     parte del flujo diario. Ahora se accede desde Administración
//     (ver adminNav más abajo, botón con data-admin-goto="table").
//   - Calidad: sus métricas siguen siendo útiles como diagnóstico,
//     pero el Dashboard es redundante con el contador/progreso de
//     Correcciones para la decisión diaria de "¿ya puedo exportar?"
//     — esa decisión ahora la resuelve el botón tricolor "Continuar a
//     Exportación" (ver ui.js → _updateFixContinueBtn(), Etapa 2).
//     Se agrega un acceso siempre visible "📊 Ver detalle de calidad"
//     en la cabecera de Correcciones (#btnGoQualityHeader) para quien
//     sí quiera profundizar.
// goStep()/renderStepper() NO cambian de comportamiento — goStep(id)
// ya toleraba ids fuera de STEPS (el indicador simplemente no se
// mueve), así que navegar a 'table'/'quality' sigue funcionando
// exactamente igual que antes.
const STEPS = [
  { id: 'prep',    label: 'Preparación' },
  { id: 'fix',     label: 'Correcciones' },
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
  // CAMBIO (jul-2026 — Etapa 4): navega directo a Correcciones
  // (goStep('fix')) en vez de a Mesa de Trabajo — ver nota de cabecera
  // "CAMBIO (jul-2026 — simplificación del flujo, Etapa 4)". El id del
  // botón se conserva (btnGoTable) para no tocar index.html más de lo
  // necesario; su texto visible ya se actualizó ahí a "Continuar a
  // Correcciones →".
  document.getElementById('btnGoTable').addEventListener('click', () => goStep('fix'));
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

  // ── Correcciones — tarjetas de corrección rápida, confirmación y "Revisar" ──
  const handleFixCardClick = e => {
    // NUEVO (jul-2026) — ver nota de cabecera "CAMBIO (jul-2026 —
    // confirmación de entregas sin PDF...)". Debe ir ANTES del check de
    // saveBtn: .fix-confirm-btn vive en la misma tarjeta que
    // .fix-review-btn (ver ui.js → _fixCardConfirm()), así que el orden
    // de los closest() importa para no confundirlos.
    const confirmBtn = e.target.closest('.fix-confirm-btn');
    if (confirmBtn) {
      const ruta  = confirmBtn.dataset.confirmRuta;
      const dette = confirmBtn.dataset.confirmDette;
      if (!confirm(`¿Confirmas que la entrega ${dette || '—'} de la ruta ${ruta} NO se realizará?\n\nSe eliminará por completo del archivo final y del historial de Supabase — esta acción no se puede deshacer una vez exportado el día.`)) return;
      Events.confirmExcludedDette(ruta, dette);
      return;
    }
    // NUEVO (jul-2026) — ver nota de cabecera "CAMBIO (jul-2026 —
    // captura dinámica de hasta 5 marchamos)". Los tres checks de la
    // tarjeta .fix-card-marchamo van ANTES de .fix-save/.fix-review-btn
    // por prolijidad, aunque no colisionan (clases CSS distintas).
    const addMarchBtn = e.target.closest('[data-fix-role="add-marchamo"]');
    if (addMarchBtn) {
      const card     = addMarchBtn.closest('.fix-card-marchamo');
      const rowsWrap = card.querySelector('[data-fix-role="rows"]');
      const slots    = JSON.parse(card.dataset.fixSlots || '[]');
      const current  = rowsWrap.querySelectorAll('.fix-marchamo-row').length;
      if (current >= slots.length) return; // ya se alcanzó el máximo de slots vacíos disponibles
      const nextSlot = slots[current];
      const row = document.createElement('div');
      row.className = 'fix-marchamo-row';
      row.dataset.slot = nextSlot;
      row.innerHTML =
        `<input class="fix-input fix-marchamo-input" data-field="${nextSlot}" placeholder="Número de marchamo…">` +
        `<button type="button" class="fix-marchamo-remove" data-fix-role="remove-marchamo">✕</button>`;
      rowsWrap.appendChild(row);
      row.querySelector('input').focus();
      if (current + 1 >= slots.length) addMarchBtn.disabled = true;
      return;
    }
    const removeMarchBtn = e.target.closest('[data-fix-role="remove-marchamo"]');
    if (removeMarchBtn) {
      const card = removeMarchBtn.closest('.fix-card-marchamo');
      removeMarchBtn.closest('.fix-marchamo-row').remove();
      // Al liberar un slot, el botón "+ Agregar" (si estaba
      // deshabilitado por haber llegado al máximo) vuelve a habilitarse.
      const addBtn = card.querySelector('[data-fix-role="add-marchamo"]');
      if (addBtn) addBtn.disabled = false;
      return;
    }
    const saveMarchBtn = e.target.closest('[data-fix-role="save-marchamo"]');
    if (saveMarchBtn) {
      const card   = saveMarchBtn.closest('.fix-card-marchamo');
      const inputs = card.querySelectorAll('.fix-marchamo-input');
      const fields = {};
      inputs.forEach(inp => {
        const val = inp.value.trim();
        if (val) fields[inp.dataset.field] = val;
      });
      if (!Object.keys(fields).length) {
        // Ningún campo capturado — no hay nada que guardar. Se marca el
        // primer input como pista visual (mismo patrón que fix-input-
        // error de la tarjeta quick), sin bloquear ni exigir un mínimo:
        // los campos siguen siendo opcionales, esto es solo feedback.
        const first = card.querySelector('.fix-marchamo-input');
        if (first) { first.focus(); first.classList.add('fix-input-error'); }
        return;
      }
      const rowIds = JSON.parse(card.dataset.fixRowids || '[]');
      EditSystem.quickFixMulti(rowIds, fields);
      return;
    }
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

  // ── Correcciones — acceso SIEMPRE visible a Calidad desde la
  // cabecera (NUEVO, jul-2026 — Etapa 4). Mismo destino que
  // #btnGoQuality de arriba, pero sin esperar a que no queden
  // incidencias pendientes — ver nota de cabecera "CAMBIO (jul-2026 —
  // simplificación del flujo, Etapa 4)". ──
  document.getElementById('btnGoQualityHeader')?.addEventListener('click', () => goStep('quality'));

  // ── Correcciones — "Continuar a Exportación" tricolor (NUEVO, jul-2026) ──
  // Ver nota de cabecera. Nunca bloquea la navegación — solo informa el
  // estado; el gate real de exportación sigue viviendo en la pantalla
  // Exportación, sin cambios.
  document.getElementById('btnFixContinue')?.addEventListener('click', () => goStep('export'));

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
    // NUEVO (jul-2026 — Etapa 4): botones con [data-admin-goto] son
    // ACCESOS DIRECTOS a otra pantalla completa (ej. Mesa de Trabajo),
    // no un sub-panel de Administración — se resuelven ANTES del
    // toggle genérico de abajo, que asume que todo botón de esta barra
    // activa un .admin-panel dentro de la misma pantalla. Ver nota de
    // cabecera "CAMBIO (jul-2026 — simplificación del flujo, Etapa 4)".
    const gotoBtn = e.target.closest('[data-admin-goto]');
    if (gotoBtn) { goStep(gotoBtn.dataset.adminGoto); return; }

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
