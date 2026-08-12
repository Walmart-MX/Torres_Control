/**
 * events/events.js
 * EVENTS — coordinador central de todos los manejadores de eventos.
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   Ninguna de las 4 fuentes es opcional. checkSources() y triggerMerge()
 *   bloquean el merge completo si falta cualquiera.
 *
 * CAMBIO (rediseño Mesa de Trabajo/Preparación — mockup jul-2026):
 *   La pantalla de Preparación reemplaza la barra de pipeline (3/4 pasos
 *   con pipeStep1..4) y los badges sueltos (pdfBadge/xlsBadge/bdgDesp)
 *   por 4 tarjetas de fuente ("up-card"). Los handlers de cada fuente ya
 *   no llaman UI.setBadge()/UI.setDZDone()/UI.setPipeStep() (retirados
 *   de ui.js, sus IDs de destino no existen en el nuevo HTML) — ahora
 *   llaman UI.setSourceStatus(key, done, statusText, subText), un único
 *   método que actualiza la tarjeta completa. triggerMerge() reemplaza
 *   UI.renderSourceGate(missing) (nunca definido en ui.js — gap
 *   detectado durante el rediseño) por UI.updatePrepView(missing), que
 *   además colapsa/expande la grilla de Preparación según
 *   Events.checkSources().ok.
 *
 * CAMBIO (jul-2026 — feedback visual de carga/procesamiento):
 *   handlePDFs/handleXLS/handleWTMS ahora alternan UI.setSourceProcessing
 *   (key, true/false) alrededor de la lectura async del archivo, siempre
 *   dentro de un try/finally — así la animación de "respiración" de la
 *   tarjeta (ver index.html, .up-card.processing) se apaga sin importar
 *   si la lectura terminó en éxito o en error. La animación de arrastre
 *   (.up-card.drag) no requiere cambios aquí: Events.setupDrop ya
 *   alternaba esa clase, lo único que faltaba era el CSS (ver index.html).
 *
 * CAMBIO (jul-2026 — administración de catálogos maestros fila por fila):
 *   Se agregan addCatalogRow()/deleteCatalogRow() — contraparte de
 *   addCatalogEntry()/delOp() (catálogo de operadores) pero para
 *   Ventana de Recibo/Pool Real vía CatalogStore.addRow()/deleteRow().
 *   importMasterCatalog() ahora también refresca UI.renderCatalogAdmin()
 *   tras un reemplazo completo, para que la tabla fila-por-fila quede
 *   sincronizada con el Excel recién importado.
 *
 * CAMBIO (Centro de Mantenimiento — Fase 2, jul-2026):
 *   Se agregan loadMaintenanceCenter()/resolveIncident()/
 *   toggleResolvedIncidents() — orquestación del panel nuevo de
 *   Administración → Centro de Mantenimiento. Events es responsable de
 *   ir a buscar los datos a IncidentStore y pasarlos a UI para pintar;
 *   UI no importa Supabase directamente (mismo contrato que el resto
 *   de la app — ver ui.js, cabecera). El sync propiamente dicho
 *   (agrupar/persistir incidencias) ocurre en processors/merge.js tras
 *   cada corrida, no aquí — este módulo solo LEE y resuelve.
 *
 * CAMBIO (jul-2026 — confirmación de entregas sin PDF, "se quedó por
 * ocupación"):
 *   Se agrega confirmExcludedDette(ruta, dette) — contraparte de
 *   quickFix()/addCatalogRow() para la nueva regla SVE 'dette_sin_pdf'
 *   (ver features/validation/sve.js). El usuario confirma desde
 *   Correcciones que una entrega sin ningún bloque de PDF no se va a
 *   realizar; este método agrega la clave a State.excludedDettes y
 *   dispara un nuevo merge — processors/merge.js filtra la fila por
 *   completo (nunca llega a State.merged), así que el Excel final y el
 *   historial de Supabase quedan automáticamente fieles a la decisión,
 *   sin que este módulo (ni export.js ni dispatch-history.js) necesiten
 *   ningún filtro adicional. La confirmación de seguridad (diálogo
 *   nativo) vive en core/app.js, mismo patrón que deleteCatalogRow().
 *
 * CAMBIO (jul-2026 — regla SVE 'integrity'/K, descuento de exclusiones):
 *   triggerMerge() ahora pasa State.excludedCount como tercer argumento
 *   a runSVE() (ver features/validation/sve.js) — permite que la regla K
 *   descuente del conteo esperado las entregas excluidas confirmadas en
 *   ESTA corrida de runMerge() (ver processors/merge.js), evitando una
 *   alerta crítica falsa cuando la diferencia se explica por completo
 *   por una exclusión legítima (ej. DETTE cancelada y confirmada por el
 *   usuario). No cambia ningún otro comportamiento de triggerMerge().
 *
 * FIX DE INTEGRIDAD DE DATOS (jul-2026) — handlePDFs():
 *   Antes se indexaba SIEMPRE `ruta + '|' + r.factura` y
 *   `ruta + '|D|' + r.destino` en State.pdfData, aunque factura/destino
 *   llegaran vacíos (entrega con bloque de PDF parcialmente ilegible).
 *   Si dos entregas de la misma ruta tenían ese campo vacío, ambas
 *   compartían la misma clave del Map y la última sobreescribía a la
 *   primera — un match "específico" podía terminar apuntando al bloque
 *   equivocado sin que nada lo detectara. Ahora solo se indexa una
 *   clave cuando el valor correspondiente NO está vacío — así una
 *   entrega sin factura/destino detectado simplemente no es alcanzable
 *   por búsqueda específica (lo cual es correcto: no hay certeza), en
 *   vez de colisionar con otra. Complementa el fix de
 *   processors/merge.js (fallback por ruta ya no adivina cuando hay
 *   más de un candidato) y el de processors/pdf.js (extracción
 *   tolerante por campo — un marchamo inválido ya no vacía
 *   factura/destino, así que esta colisión de claves vacías será cada
 *   vez menos frecuente, pero se corrige de raíz de todas formas).
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
import { IncidentStore } from '../features/incidents/incident-store.js';

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
      UI.renderCatalogAdmin(catalogId);
      UI.setMasterCatStatus(`✓ ${result.count} registros cargados`, 'ok');
      if (State.merged.length) Events.triggerMerge();
    } catch (e) {
      UI.setMasterCatStatus('Error: ' + e.message, 'err');
    }
  },

  /**
   * Agrega UN registro individual a un catálogo maestro desde el panel
   * de Administración — contraparte de addCatalogEntry() (operadores),
   * pero genérica sobre CATALOGS (ver ui.js → renderCatalogAdmin()).
   * @param {string} catalogId — 'ventanaRecibo' | 'poolReal'
   * @param {object} values — { columnaCanonica: valor } capturado del formulario
   */
  async addCatalogRow(catalogId, values) {
    UI.setCatalogAdminStatus(catalogId, 'Guardando…', 'ok');
    try {
      await CatalogStore.addRow(catalogId, values, State.user);
      UI.renderCatalogAdmin(catalogId);
      UI.renderCatalogMasterStatus(catalogId);
      UI.setCatalogAdminStatus(catalogId, '✓ Registro agregado', 'ok');
      if (State.merged.length) Events.triggerMerge();
    } catch (e) {
      UI.setCatalogAdminStatus(catalogId, e.message, 'err');
    }
  },

  /**
   * Elimina UN registro individual de un catálogo maestro por su _id.
   * @param {string} catalogId — 'ventanaRecibo' | 'poolReal'
   * @param {string} id — _id del registro (uuid de Supabase)
   */
  async deleteCatalogRow(catalogId, id) {
    UI.setCatalogAdminStatus(catalogId, 'Eliminando…', 'ok');
    try {
      await CatalogStore.deleteRow(catalogId, id, State.user);
      UI.renderCatalogAdmin(catalogId);
      UI.renderCatalogMasterStatus(catalogId);
      UI.setCatalogAdminStatus(catalogId, 'Eliminado', 'ok');
      if (State.merged.length) Events.triggerMerge();
    } catch (e) {
      UI.setCatalogAdminStatus(catalogId, e.message, 'err');
    }
  },

  async handlePDFs(files) {
    files = files.filter(f => f.type === 'application/pdf');
    if (!files.length) return;
    UI.showProgress('Procesando PDFs…');
    UI.setSourceProcessing('pdf', true);
    const errors = [];
    let ok = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        try {
          const extracted = await pdfExtract(files[i]);
          const parsed    = parsePDF(extracted, files[i].name);
          for (const r of parsed) {
            // FIX (jul-2026) — ver nota de cabecera "FIX DE INTEGRIDAD DE
            // DATOS": nunca indexar una clave con factura/destino vacío.
            // Una entrega sin ese dato detectado queda fuera del match
            // específico (correcto: no hay certeza) en vez de arriesgarse
            // a colisionar con otra entrega de la misma ruta.
            if (r.factura) State.pdfData.set(r.ruta + '|' + r.factura,   r);
            if (r.destino) State.pdfData.set(r.ruta + '|D|' + r.destino, r);
          }
          if (parsed.length) ok++;
          else errors.push('Sin datos: ' + files[i].name);
        } catch (e) { errors.push('Error: ' + files[i].name + ' — ' + e.message); }
        UI.setProgress(i + 1, files.length, files[i].name);
      }
    } finally {
      UI.setSourceProcessing('pdf', false);
    }
    UI.hideProgress();

    const uniqueCount = new Set([...State.pdfData.keys()].filter(k => !k.includes('|D|'))).size;
    UI.setSourceStatus('pdf', true, '✓ Completo', `${ok} archivos · ${uniqueCount} entregas`);

    if (errors.length) UI.showErrors(errors);
    Events.triggerMerge();
  },

  async handleXLS(files) {
    const file = files.find(f => f.name.match(/\.xlsx?$/i));
    if (!file) return;
    UI.showProgress('Leyendo Excel…');
    UI.setSourceProcessing('xls', true);
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

      UI.setSourceStatus('xls', true, '✓ Completo', `${rows.length} rutas · ${factSheetLabel}`);

      UI.hideProgress();
      Events.triggerMerge();
    } catch (e) {
      UI.hideProgress();
      UI.showErrors([e.message]);
    } finally {
      UI.setSourceProcessing('xls', false);
    }
  },

  // ── Reporte WTMS handler (4ª fuente obligatoria) ──
  async handleWTMS(files) {
    const file = files.find(f => f.name.match(/\.csv$/i));
    if (!file) { if (files.length) UI.showErrors(['El Reporte WTMS debe ser un archivo .csv']); return; }
    UI.showProgress('Leyendo Reporte WTMS…');
    UI.setSourceProcessing('wtms', true);
    try {
      const raw = await file.text();
      const { data } = processWTMS(raw);
      State.wtmsData = data;

      UI.setSourceStatus('wtms', true, '✓ Completo', `${data.size} cargas`);

      UI.hideProgress();
      Events.triggerMerge();
    } catch (e) {
      UI.hideProgress();
      UI.showErrors([e.message]);
    } finally {
      UI.setSourceProcessing('wtms', false);
    }
  },

  handlePaste() {
    const raw = document.getElementById('pasteArea').value.trim();
    if (!raw) { UI.setPasteSt('Pega datos primero', 'err'); return; }
    UI.setPasteSt('Procesando…', 'proc');
    try {
      const { data, preview, idx } = processPaste(raw);
      State.despData = data;
      UI.setPasteSt(`✓ ${data.size} rutas detectadas`, 'ok');
      UI.setSourceStatus('desp', true, '✓ Completo', `${data.size} rutas detectadas`);
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
    UI.setPasteSt('', '');
    UI.setSourceStatus('desp', false, 'Pega desde Excel', 'Copia RUTA · CASETA · WTMS · ID\'S MASTER');
    Events.triggerMerge();
  },

  // ── Validación de fuentes obligatorias ──
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
    UI.updatePrepView(missing);

    if (!ok) {
      State.merged = [];
      State.sveIssues = [];
      UI.renderTable();
      UI.renderFixList();
      UI.renderQualityScreen();
      UI.renderExportScreen();
      UI.updateStats();
      UI.resetSVE();
      UI.setActionsEnabled(false);
      UI.updateHealthRail();
      UI.applyMode();
      return;
    }

    // Marca de "inicio de captura" — solo la primera vez que las 4
    // fuentes están completas en esta sesión (ver nota en state.js).
    if (!State.captureStartedAt) State.captureStartedAt = Date.now();

    runMerge();
    // Nuevo merge completo = nueva sesión de corrección — el progreso
    // de Correcciones y el "antes/después" de Calidad arrancan de cero
    // contra el total fresco de este merge, no contra el de la corrida
    // anterior.
    UI.resetFixPeak();
    UI.resetQualityBaseline();
    UI.renderTable();
    UI.updateStats();
    UI.setActionsEnabled(true);
    setTimeout(() => {
      const screenCount = State.xlsData ? State.xlsData.length : 0;
      // CAMBIO (jul-2026): se pasa State.excludedCount (calculado en
      // runMerge(), ver processors/merge.js) para que la regla K de
      // sve.js pueda descontar las exclusiones confirmadas de ESTA
      // corrida antes de comparar — ver nota de cabecera de este
      // archivo y de features/validation/sve.js.
      const sveResult = runSVE(State.merged, screenCount, State.excludedCount);
      if (sveResult) {
        State.sveIssues = sveResult.issues;
        UI.renderSVE(sveResult.issues, sveResult.quality, sveResult.nCrit, sveResult.nWarn, sveResult.nInfo, sveResult.nPass);
      } else {
        State.sveIssues = [];
        UI.resetSVE();
      }
      // El status pill por fila, Correcciones, Calidad y Exportación
      // dependen de State.sveIssues, recién poblado arriba — en ese
      // orden: la barra de progreso de Correcciones fija su "pico"
      // primero, y Calidad/Exportación reutilizan ese mismo pico.
      UI.renderTable();
      UI.renderFixList();
      UI.renderQualityScreen();
      UI.renderExportScreen();
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
    UI.showCelebrate();
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
  },

  // ═══════════════════════════════════════════════════════════════
  // ── CENTRO DE MANTENIMIENTO (Fase 2, jul-2026) ──
  // ═══════════════════════════════════════════════════════════════

  /**
   * Carga las incidencias abiertas (ya ordenadas por prioridad, ver
   * IncidentStore.listOpen()) y las pinta en el panel de
   * Administración → Centro de Mantenimiento. Se llama cada vez que el
   * usuario entra a ese sub-panel (ver app.js → adminNav listener) —
   * los datos pueden haber cambiado desde la última corrida de merge,
   * así que se refresca en cada visita en vez de cachear.
   */
  async loadMaintenanceCenter() {
    UI.setMaintenanceStatus('Cargando…', 'ok');
    try {
      const incidents = await IncidentStore.listOpen();
      UI.renderMaintenanceCenter(incidents);
      UI.setMaintenanceStatus('', '');
    } catch (e) {
      UI.setMaintenanceStatus('Error: ' + e.message, 'err');
    }
  },

  /**
   * Marca una incidencia como resuelta manualmente (el usuario sabe
   * que ya no va a repetirse aunque el sistema no lo detecte todavía —
   * ej. corrección pendiente en el próximo Excel) y refresca el panel.
   * @param {string} id — uuid de la incidencia en admin_incidents
   */
  async resolveIncident(id) {
    UI.setMaintenanceStatus('Resolviendo…', 'ok');
    try {
      await IncidentStore.resolveManually(id, State.user);
      await Events.loadMaintenanceCenter();
    } catch (e) {
      UI.setMaintenanceStatus('Error: ' + e.message, 'err');
    }
  },

  /**
   * Muestra/oculta la sección colapsable de incidencias resueltas.
   * Se recarga desde Supabase cada vez que se abre (no se cachea) —
   * mismo criterio que openHistory(): panel de baja frecuencia, el
   * costo de una consulta extra es preferible a mostrar datos
   * potencialmente obsoletos tras resolver una incidencia nueva.
   */
  async toggleResolvedIncidents() {
    const wrap = document.getElementById('mcResolvedWrap');
    if (!wrap) return;
    const willShow = wrap.style.display === 'none';
    wrap.style.display = willShow ? '' : 'none';
    if (willShow) {
      const resolved = await IncidentStore.listResolved();
      UI.renderResolvedIncidents(resolved);
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // ── ENTREGAS SIN PDF — confirmación de exclusión (jul-2026) ──
  // ═══════════════════════════════════════════════════════════════

  /**
   * Confirma que una entrega sin PDF NO se va a realizar (ej. se quedó
   * por ocupación) — la agrega a State.excludedDettes y dispara un
   * nuevo merge. La entrega desaparece POR COMPLETO de State.merged
   * (ver processors/merge.js) y por lo tanto de la tabla, el SVE, el
   * Excel exportado y el historial de Supabase — los tres leen
   * State.merged directamente, no requieren ningún filtro adicional.
   * La confirmación del usuario (diálogo nativo) vive en el listener
   * del DOM (ver core/app.js), no aquí — mismo patrón que
   * deleteCatalogRow()/resolveIncident(): Events recibe la decisión ya
   * tomada y solo ejecuta el efecto.
   * @param {string} ruta
   * @param {string} dette
   */
  confirmExcludedDette(ruta, dette) {
    if (!ruta || !dette) return;
    State.excludedDettes.add(String(ruta).trim() + '||' + String(dette).trim());
    Events.triggerMerge();
  }
};
