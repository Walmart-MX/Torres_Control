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
 *   pasos numerados), actualizar el indicador.
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
 * CAMBIO (ago-2026 — "reabrir para corregir"):
 *   Se agrega el listener de #btnHistoryReopen, junto al de
 *   #btnHistoryRedownload — reutiliza Events._currentHistorySession
 *   (mismo dato ya fijado por selectHistorySession()/
 *   previewTodaySession()). Llama a Events.reopenSession(), cierra el
 *   modal de Historial y navega a Correcciones (goStep('fix')) para
 *   que el usuario continúe corrigiendo de inmediato. Ver
 *   events/events.js (reopenSession()/checkSources()) y ui/ui.js
 *   (renderFixList(), aviso contextual) para el resto del mecanismo.
 *
 * CAMBIO (ago-2026 — login como primera vista, sin "flash" de la app):
 *   La app entera (.shell) queda oculta por CSS hasta que
 *   <body> tenga la clase 'app-authed' (ver regla en index.html:
 *   body:not(.app-authed) .shell{display:none!important}). Se agrega
 *   document.body.classList.add('app-authed') en los TRES puntos donde
 *   ya se decidía "el usuario está autenticado, mostrar la app":
 *     1) init() → rama Auth.restoreSession() exitosa (sesión ya
 *        vigente en esta terminal, no requiere overlay de login)
 *     2) afterLoginSuccess() → login normal completado
 *     3) el submit handler de authFormProfile → primer login,
 *        tras confirmar perfil
 *   NO se toca la lógica de Auth/RPCs en absoluto — es un cambio
 *   puramente de visibilidad, complementario a UI.hideAuthOverlay()
 *   (que ya se llamaba en los mismos 3 puntos, salvo el 1, donde el
 *   overlay nunca llegó a mostrarse).
 *
 * CAMBIO (ago-2026 — cerrar el modal de configuración de usuario):
 *   UI.closeModal() ya existía pero no tenía ningún disparador en el
 *   DOM. Se agregan dos listeners nuevos, mismo patrón que
 *   #historyModalOverlay: click en el botón "×" (#btnCfgClose) y click
 *   en el "Cancelar" (#btnCfgCancel) → UI.closeModal(); click en el
 *   overlay FUERA de .modal-box (mismo filtro e.target === overlay que
 *   ya usan warnModalOverlay/routePickerOverlay/historyModalOverlay) →
 *   UI.closeModal(). No se toca el guardado (#nameModalBtn) en
 *   absoluto.
 *
 * CAMBIO (ago-2026 — validación informativa Excel vs PDF en
 * Preparación):
 *   Se agrega el listener de #btnScToggle → UI.toggleSourceCheckDetail()
 *   (ver ui.js/features/source-check.js). Simple toggle de visibilidad,
 *   sin ninguna llamada a Events — la tarjeta ya se actualiza sola
 *   desde Events.triggerMerge().
 *
 * Dependencias: todos los módulos de la aplicación.
 */
import { Auth } from '../features/auth.js';
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
let _activityWired = false;
let _pendingFirstLoginPassword = null;
// NUEVO — protección simple del panel Administración → Usuarios.
// Cortina de acceso, NO seguridad real (ver nota abajo): el panel de
// gestión de cuentas es sensible pero de bajo tráfico — un prompt()
// basta para evitar accesos accidentales o de personal no autorizado
// casual. Se desbloquea una sola vez por sesión de navegador (no
// persiste en localStorage — recargar vuelve a pedirla).
let _usersPanelUnlocked = false;
const USERS_PANEL_PASSWORD = 'rainmeter99';

function wireActivityTracking() {
  if (_activityWired) return;
  _activityWired = true;
  ['click', 'keydown'].forEach(evt => document.addEventListener(evt, () => Auth.touchActivity()));
}

function handleSessionExpired() {
  const known = Auth.getKnownUser();
  UI.showAuthKnown(known ? `${Auth.greeting()}, ${known.displayName}` : '—');
}

async function afterLoginSuccess(result) {
  if (result.isFirstLogin) {
    UI.showAuthProfile({ displayName: result.user.displayName, captureName: result.user.captureName });
    return;
  }
  _pendingFirstLoginPassword = null;
  UI.setUser(State.currentUser);
  UI.hideAuthOverlay();
  // NUEVO (ago-2026 — login como primera vista): revela .shell — ver
  // nota de cabecera de este archivo y la regla CSS en index.html.
  document.body.classList.add('app-authed');
  Auth.startExpiryWatch(handleSessionExpired);
  wireActivityTracking();
  await continueInit();
}

function wireAuthForms() {
  document.getElementById('authFormKnown').addEventListener('submit', async e => {
    e.preventDefault();
    const known  = Auth.getKnownUser();
    const pass   = document.getElementById('authKnownPassword').value;
    const errEl  = document.getElementById('authKnownError');
    errEl.textContent = '';
    const result = await Auth.login(known.username, pass);
    if (!result.ok) {
      errEl.textContent = result.error === 'inactive' ? 'Esta cuenta está inactiva.' : 'Contraseña incorrecta.';
      return;
    }
    _pendingFirstLoginPassword = pass;
    await afterLoginSuccess(result);
  });

  document.getElementById('authChangeUser').addEventListener('click', () => {
    Auth.changeUser();
    UI.showAuthFull();
  });

  document.getElementById('authFormFull').addEventListener('submit', async e => {
    e.preventDefault();
    const user  = document.getElementById('authFullUsername').value.trim();
    const pass  = document.getElementById('authFullPassword').value;
    const errEl = document.getElementById('authFullError');
    errEl.textContent = '';
    if (!user || !pass) { errEl.textContent = 'Completa usuario y contraseña.'; return; }
    const result = await Auth.login(user, pass);
    if (!result.ok) { errEl.textContent = 'Usuario o contraseña incorrectos.'; return; }
    _pendingFirstLoginPassword = pass;
    await afterLoginSuccess(result);
  });

  document.getElementById('authFormProfile').addEventListener('submit', async e => {
    e.preventDefault();
    const displayName = document.getElementById('authProfileDisplay').value.trim();
    const captureName = document.getElementById('authProfileCapture').value.trim();
    const newPass      = document.getElementById('authProfileNewPassword').value;
    const errEl        = document.getElementById('authProfileError');
    errEl.textContent = '';
    if (!displayName || !captureName) { errEl.textContent = 'Completa ambos campos.'; return; }

    const currentPass = _pendingFirstLoginPassword;
    const profResult  = await Auth.updateProfile(currentPass, displayName, captureName);
    if (!profResult.ok) { errEl.textContent = 'No se pudo guardar tu perfil — intenta de nuevo.'; return; }
    if (newPass) {
      const pwResult = await Auth.changePassword(currentPass, newPass);
      if (!pwResult.ok) errEl.textContent = 'Perfil guardado, pero no se pudo cambiar la contraseña.';
    }
    _pendingFirstLoginPassword = null;
    UI.setUser(State.currentUser);
    UI.hideAuthOverlay();
    // NUEVO (ago-2026 — login como primera vista): ver nota de cabecera.
    document.body.classList.add('app-authed');
    Auth.startExpiryWatch(handleSessionExpired);
    wireActivityTracking();
    await continueInit();
  });
}

/**
 * Punto de entrada real. wireAuthForms() se engancha SIEMPRE, haya o no
 * sesión — el resto del bootstrap (continueInit) solo corre tras login
 * exitoso o sesión restaurada (login bloqueante, ver propuesta §17).
 */
export async function init() {
  _setRoutePicker(RoutePicker);
  _setEvents(Events);
  _setWarnModalEvents(Events);

  UI.applyTheme(State.theme);
  wireAuthForms();

  if (Auth.restoreSession()) {
    UI.setUser(State.currentUser);
    // NUEVO (ago-2026 — login como primera vista): sesión ya vigente en
    // esta terminal — el overlay de login nunca llega a mostrarse, pero
    // .shell seguía oculto por CSS hasta este punto (ver regla nueva en
    // index.html). Se revela aquí, antes de continueInit(), para que la
    // app aparezca de inmediato sin esperar ningún dato de red.
    document.body.classList.add('app-authed');
    Auth.startExpiryWatch(handleSessionExpired);
    wireActivityTracking();
    await continueInit();
    return;
  }

  const known = Auth.getKnownUser();
  if (known) UI.showAuthKnown(`${Auth.greeting()}, ${known.displayName}`);
  else       UI.showAuthFull();
  // continueInit() se dispara desde wireAuthForms() tras login exitoso.
}

/**
 * Bootstrap completo de la aplicación — antes vivía como el cuerpo de
 * init(). Se extrae sin cambios de comportamiento salvo los señalados:
 * ya no llama UI.applyTheme/UI.setUser(String) (resuelto antes de
 * llegar aquí) y el nameInput/first-run modal de nombre libre se
 * retiran (reemplazados por el flujo de auth de arriba).
 */
async function continueInit() {
  renderStepper();
  document.getElementById('btnAdmin').addEventListener('click', () => goStep('admin'));

  State.factCache    = await FactCache.load();
  State.factCacheLog = await FactCache.loadLog();
  const fcStats = FactCache.stats();
  if (fcStats.total > 0) {
    console.log('[FactCache] Loaded', fcStats.total, 'invoices from', fcStats.days, 'day(s):', fcStats.dates.join(', '));
  }
  UI.renderCacheHistory();

  Events.setupDrop('dropPDF', 'filePDF', Events.handlePDFs.bind(Events));
  Events.setupDrop('dropXLS', 'fileXLS', Events.handleXLS.bind(Events));
  Events.setupDrop('dropWTMS', 'fileWTMS', Events.handleWTMS.bind(Events));

  document.getElementById('btnGoTable').addEventListener('click', () => goStep('fix'));
  document.getElementById('btnPrepReset').addEventListener('click', () => UI.resetAll());

  document.getElementById('btnParse').addEventListener('click',      () => Events.handlePaste());
  document.getElementById('btnPasteClear').addEventListener('click', () => Events.clearPaste());

  // NUEVO (ago-2026 — validación Excel vs PDF): simple toggle de
  // visibilidad del detalle de diferencias — la tarjeta en sí ya se
  // actualiza sola desde Events.triggerMerge(), este listener no llama
  // a Events en absoluto.
  document.getElementById('btnScToggle')?.addEventListener('click', () => UI.toggleSourceCheckDetail());

  document.getElementById('btnExport').addEventListener('click', () => Events.handleExport());

  document.getElementById('btnTheme').addEventListener('click', () =>
    UI.applyTheme(State.theme === 'dark' ? 'light' : 'dark'));

  document.querySelectorAll('.theme-opt[data-theme]').forEach(el => {
    el.addEventListener('click', () => UI.applyTheme(el.dataset.theme));
  });

  document.getElementById('tbUser').addEventListener('click', () => UI.openModal());

  // ── Configuración — Mi cuenta (reemplaza el guardado de nombre libre) ──
  document.getElementById('nameModalBtn').addEventListener('click', async () => {
    const displayName     = document.getElementById('cfgDisplayName').value.trim();
    const captureName     = document.getElementById('cfgCaptureName').value.trim();
    const currentPassword = document.getElementById('cfgCurrentPassword').value;
    const newPassword     = document.getElementById('cfgNewPassword').value;
    const statusEl = document.getElementById('cfgStatus');

    if (!displayName || !captureName) {
      statusEl.textContent = 'Completa nombre y nombre en CAPTURA.'; statusEl.style.color = 'var(--red)'; return;
    }
    if (!currentPassword) {
      statusEl.textContent = 'Ingresa tu contraseña actual para guardar cambios.'; statusEl.style.color = 'var(--red)'; return;
    }
    statusEl.textContent = 'Guardando…'; statusEl.style.color = '';

    const profResult = await Auth.updateProfile(currentPassword, displayName, captureName);
    if (!profResult.ok) {
      statusEl.textContent = profResult.error === 'invalid_password' ? 'Contraseña actual incorrecta.' : 'No se pudo guardar.';
      statusEl.style.color = 'var(--red)';
      return;
    }
    if (newPassword) {
      const pwResult = await Auth.changePassword(currentPassword, newPassword);
      if (!pwResult.ok) {
        statusEl.textContent = 'Nombre guardado, pero no se pudo cambiar la contraseña.'; statusEl.style.color = 'var(--amber-deep)'; return;
      }
    }
    UI.setUser(State.currentUser);
    statusEl.textContent = '✓ Cambios guardados'; statusEl.style.color = 'var(--green)';
    document.getElementById('cfgCurrentPassword').value = '';
    document.getElementById('cfgNewPassword').value     = '';
  });

  // ── NUEVO (ago-2026 — cerrar el modal de configuración de usuario) ──
  // UI.closeModal() ya existía pero no tenía ningún disparador en el
  // DOM. Mismo patrón que #historyModalOverlay/#warnModalOverlay/
  // #routePickerOverlay: botón "×", botón "Cancelar" y click en el
  // overlay fuera de .modal-box — ninguno guarda cambios.
  document.getElementById('btnCfgClose')?.addEventListener('click', () => UI.closeModal());
  document.getElementById('btnCfgCancel')?.addEventListener('click', () => UI.closeModal());
  document.getElementById('nameModal').addEventListener('click', e => {
    if (e.target === document.getElementById('nameModal')) UI.closeModal();
  });

  document.getElementById('tableSearch').addEventListener('input', e => UI.setTableSearch(e.target.value));
  document.getElementById('filterChips').addEventListener('click', e => {
    const btn = e.target.closest('.fchip');
    if (!btn) return;
    UI.setTableFilter(btn.dataset.filter);
  });

  document.getElementById('mainTbody').addEventListener('click', e => {
    const btn = e.target.closest('.row-edit-btn');
    if (!btn) return;
    EditSystem.locateAndEdit(btn.dataset.editRuta, '', JSON.stringify([btn.dataset.editRowid]));
  });

  const btnGoFix = document.getElementById('btnGoFix');
  if (btnGoFix) btnGoFix.addEventListener('click', () => goStep('fix'));

  const handleFixCardClick = e => {
    const confirmBtn = e.target.closest('.fix-confirm-btn');
    if (confirmBtn) {
      const ruta  = confirmBtn.dataset.confirmRuta;
      const dette = confirmBtn.dataset.confirmDette;
      if (!confirm(`¿Confirmas que la entrega ${dette || '—'} de la ruta ${ruta} NO se realizará?\n\nSe eliminará por completo del archivo final y del historial de Supabase — esta acción no se puede deshacer una vez exportado el día.`)) return;
      Events.confirmExcludedDette(ruta, dette);
      return;
    }
    const addMarchBtn = e.target.closest('[data-fix-role="add-marchamo"]');
    if (addMarchBtn) {
      const card     = addMarchBtn.closest('.fix-card-marchamo');
      const rowsWrap = card.querySelector('[data-fix-role="rows"]');
      const slots    = JSON.parse(card.dataset.fixSlots || '[]');
      const current  = rowsWrap.querySelectorAll('.fix-marchamo-row').length;
      if (current >= slots.length) return;
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
      const addBtn = card.querySelector('[data-fix-role="add-marchamo"]');
      if (addBtn) addBtn.disabled = false;
      return;
    }
    const saveMarchBtn = e.target.closest('[data-fix-role="save-marchamo"]');
    if (saveMarchBtn) {
      const card   = saveMarchBtn.closest('.fix-card-marchamo');
      const inputs = card.querySelectorAll('.fix-marchamo-input');
      const fields = {};
      inputs.forEach(inp => { const val = inp.value.trim(); if (val) fields[inp.dataset.field] = val; });
      if (!Object.keys(fields).length) {
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

  const btnGoQuality = document.getElementById('btnGoQuality');
  if (btnGoQuality) btnGoQuality.addEventListener('click', () => goStep('quality'));
  document.getElementById('btnGoQualityHeader')?.addEventListener('click', () => goStep('quality'));
  document.getElementById('btnFixContinue')?.addEventListener('click', () => goStep('export'));

  document.getElementById('btnCelebrateClose')?.addEventListener('click', () => {
    UI.hideCelebrate();
    goStep('prep');
  });

    document.getElementById('adminNav').addEventListener('click', e => {
    const gotoBtn = e.target.closest('[data-admin-goto]');
    if (gotoBtn) { goStep(gotoBtn.dataset.adminGoto); return; }

    const btn = e.target.closest('.admin-nav-item');
    if (!btn) return;

    // NUEVO — gate de contraseña para el panel Usuarios. Ver nota de
    // cabecera junto a _usersPanelUnlocked/USERS_PANEL_PASSWORD.
    if (btn.dataset.admin === 'users' && !_usersPanelUnlocked) {
      const pass = prompt('Este panel está protegido. Ingresa la contraseña para continuar:');
      if (pass === null) return; // canceló — no hace nada, no cambia de panel
      if (pass !== USERS_PANEL_PASSWORD) { alert('Contraseña incorrecta.'); return; }
      _usersPanelUnlocked = true;
    }

    document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('active', p.dataset.adminPanel === btn.dataset.admin));
    if (btn.dataset.admin === 'maint') Events.loadMaintenanceCenter();
    if (btn.dataset.admin === 'users') refreshUsersAdmin();
  });
  document.getElementById('mcVentanaFile').addEventListener('change', function() {
    Events.importMasterCatalog('ventanaRecibo', this.files[0]); this.value = '';
  });
  document.getElementById('mcPoolFile').addEventListener('change', function() {
    Events.importMasterCatalog('poolReal', this.files[0]); this.value = '';
  });

  wireCatalogAdmin('ventanaRecibo', 'mcVentanaAdmin');
  wireCatalogAdmin('poolReal', 'mcPoolAdmin');

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

  // ── Administración — Usuarios (NUEVO) ──
  document.getElementById('btnUserAdd').addEventListener('click', async () => {
    const username    = document.getElementById('userUsernameInput').value.trim();
    const password    = document.getElementById('userPasswordInput').value;
    const displayName = document.getElementById('userDisplayInput').value.trim();
    const captureName = document.getElementById('userCaptureInput').value.trim();
    if (!username || !password || !displayName || !captureName) {
      UI.setUsersStatus('Completa todos los campos.', 'err'); return;
    }
    UI.setUsersStatus('Creando…', 'ok');
    const result = await Auth.adminCreateUser(username, password, displayName, captureName);
    if (!result.ok) {
      UI.setUsersStatus(result.error === 'duplicate_username' ? 'Ese usuario ya existe.' : 'Error al crear usuario', 'err');
      return;
    }
    ['userUsernameInput','userPasswordInput','userDisplayInput','userCaptureInput'].forEach(id => document.getElementById(id).value = '');
    UI.setUsersStatus('✓ Usuario creado', 'ok');
    await refreshUsersAdmin();
  });
  document.getElementById('usersTbody').addEventListener('click', async e => {
    const toggleBtn = e.target.closest('[data-user-toggle]');
    if (toggleBtn) {
      const active = toggleBtn.dataset.userToggle === 'activate';
      await Auth.adminSetActive(toggleBtn.dataset.userId, active);
      await refreshUsersAdmin();
      return;
    }
    const resetBtn = e.target.closest('[data-user-reset]');
    if (resetBtn) {
      const newPass = prompt('Nueva contraseña temporal para este usuario:');
      if (!newPass) return;
      await Auth.adminResetPassword(resetBtn.dataset.userId, newPass);
      UI.setUsersStatus('✓ Contraseña restablecida', 'ok');
    }
  });

  document.getElementById('mcOpenTbody').addEventListener('click', e => {
    const btn = e.target.closest('[data-mc-resolve]');
    if (!btn) return;
    if (!confirm('¿Marcar esta incidencia como resuelta manualmente? Esta acción no se puede deshacer.')) return;
    Events.resolveIncident(btn.dataset.mcResolve);
  });
  document.getElementById('btnMcToggleResolved').addEventListener('click', () => Events.toggleResolvedIncidents());

  document.getElementById('btnHistoryOpenAdmin')?.addEventListener('click', () => Events.openHistory());
  document.getElementById('btnOpenSettingsAdmin')?.addEventListener('click', () => UI.openModal());

  document.getElementById('btnCacheHistClear').addEventListener('click', async () => {
    if (!confirm('¿Eliminar todo el caché histórico de facturas? Esta acción no se puede deshacer.')) return;
    await FactCache.clear();
    await FactCache.clearLog();
    UI.renderCacheHistory();
  });

  document.getElementById('wmReview').addEventListener('click', () => WarnModal.review());
  document.getElementById('wmExport').addEventListener('click', () => WarnModal.exportAnyway());
  document.getElementById('warnModalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('warnModalOverlay')) WarnModal.close();
  });

  document.getElementById('rpOptions').addEventListener('click', e => {
    const opt = e.target.closest('.route-picker-opt');
    if (!opt) return;
    RoutePicker._pick(opt.dataset.rowid);
  });
  document.getElementById('rpCancel').addEventListener('click', () => RoutePicker.close());
  document.getElementById('routePickerOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('routePickerOverlay')) RoutePicker.close();
  });

  document.getElementById('btnEditSave').addEventListener('click',   () => EditSystem.saveAndRevalidate());
  document.getElementById('btnEditCancel').addEventListener('click', () => EditSystem.close());
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { EditSystem.close(); WarnModal.close(); RoutePicker.close(); UI.closeModal(); }
  });

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

  document.getElementById('btnHistoryReopen')?.addEventListener('click', async () => {
    if (!Events._currentHistorySession) return;
    await Events.reopenSession(Events._currentHistorySession.id);
    document.getElementById('historyModalOverlay').classList.add('hidden');
    goStep('fix');
  });

  document.getElementById('btnTodayPreview').addEventListener('click', () => Events.previewTodaySession());
  document.getElementById('btnTodayRedownload').addEventListener('click', () => Events.redownloadToday());

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

  UI.setCatStatus('Cargando catálogo…', 'ok');
  const catResult = await initCatalog();
  UI.renderCatalog();
  UI.setCatStatus(catResult.msg, catResult.ok ? 'ok' : 'err');

  await CatalogStore.loadAll();
  UI.renderCatalogMasterStatus('ventanaRecibo');
  UI.renderCatalogMasterStatus('poolReal');
  UI.renderCatalogAdmin('ventanaRecibo');
  UI.renderCatalogAdmin('poolReal');

  const todaySession = await DispatchHistory.getTodaySession();
  State.todaySession = todaySession;
  UI.renderTodayBanner(todaySession);
  UI.applyMode();

  // First-run/nameModal de nombre libre — RETIRADO. La identidad ahora
  // se resuelve por completo en el flujo de auth, antes de llegar aquí.
}

async function refreshUsersAdmin() {
  const users = await Auth.adminListUsers();
  UI.renderUsersAdmin(users);
}
