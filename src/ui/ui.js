/**
 * ui/ui.js
 * Objeto UI — única capa de manipulación del DOM en SmartDispatch.
 *
 * Todos los métodos reciben datos calculados y los pintan en el DOM.
 * Ningún método de UI debe tomar decisiones de negocio — eso es
 * responsabilidad de Events, EditSystem o los processors.
 *
 * CAMBIO — Fase 1 del rediseño "Centro de Operaciones" (PulseBar):
 *   updateHealthRail() y updateStats() dejaban de tener sentido tal
 *   cual estaban — pintaban a IDs (hPDF/hCov/hQual/hStatus,
 *   stMatch/stNoMatch/stLic/stDesp) que ya no existen en index.html,
 *   reemplazados por la PulseBar del topbar (ver ui/pulse-bar.js).
 *   Se CONSERVAN AMBOS NOMBRES PÚBLICOS sin cambios — todos los
 *   callers existentes (core/app.js, events.js, editing/edit-system.js,
 *   y la propia ui.js en resetAll/renderSVE) siguen llamándolos
 *   exactamente igual. Internamente:
 *     - updateHealthRail() ahora arma los datos agregados del día y
 *       delega el pintado a PulseBar.render().
 *     - updateStats() perdió los `set()` a stMatch/stNoMatch/stLic/
 *       stDesp (elementos eliminados) pero conserva intacto todo lo
 *       demás: el badge de cache-hits, los badges bdgPDF/bdgXLS/
 *       bdgMatch/bdgNoMatch/bdgDesp (siguen en la barra de acciones,
 *       fuera del alcance de esta fase) y previewDesc.
 *   renderSVE() perdió el bloque que pintaba shield/ring/subtitle
 *   (elementos eliminados de index.html) pero conserva sin cambios:
 *   los contadores sveCrit/sveWarn/sveInfo/svePass (ahora ocultos vía
 *   CSS `.sve-counters-hidden`, NO eliminados del DOM — events.js
 *   `handleForceExport()` y warn-modal.js `show()`/`exportAnyway()`
 *   siguen leyendo su textContent directamente y no se tocan en esta
 *   fase), el render de grupos de incidencias (sveAlerts) y la lógica
 *   completa del export gate. Cero cambio de comportamiento funcional.
 *
 * CAMBIO — Fase 3 del rediseño (SVE como semáforo colapsable):
 *   renderSVE() ahora también pinta una barra de resumen de una línea
 *   (sveSummaryToggle/Ico/Text) y decide si el cuerpo del panel
 *   (sveBody: grupos de incidencias + gate) queda expandido o
 *   colapsado. Regla: un crítico siempre fuerza la expansión; si no
 *   hay críticos, se conserva el estado de expansión que el usuario ya
 *   tenía (renderSVE() se re-ejecuta en cada guardado del drawer de
 *   edición, y no debe cerrarle el panel en plena revisión). resetSVE()
 *   colapsa el panel y limpia el resumen. El toggle de clic vive en
 *   core/app.js. Cero cambio en sve.js — sigue devolviendo datos puros.
 *
 * CAMBIO — Fase 5 del rediseño (ModeSurface / operationalMode):
 *   updateHealthRail() ahora también lee State.operationalMode (getter
 *   puro en core/state.js) y se lo pasa a PulseBar.render() para que
 *   distinga 'arranque' de 'triage' en su mensaje idle. Se agrega
 *   applyMode() — un método de una sola línea que refleja el modo
 *   como atributo data-mode en <body>; todo el comportamiento visual
 *   por modo (colapso de las tarjetas de ingesta, énfasis del botón de
 *   exportar en modo 'listo') vive en CSS puro en index.html, no aquí.
 *   Se llama desde los mismos puntos donde ya se recalculaba el estado
 *   global — ver comentario del propio método para la lista completa.
 *
 * Dependencias:
 *   - State (core/state.js) — lee estado para calcular lo que muestra,
 *     y en algunos métodos lo muta (resetAll, resetSVE, setUser)
 *   - escH (utils/dom.js) — escape HTML para inserción segura en innerHTML
 *   - fmtDate (utils/format.js) — formatea fechas en la tabla preview
 *   - getMapped, COLS_PDF, COLS_DESP, COLS_FILL,
 *     PREVIEW_COLS (core/constants.js) — para renderizar la tabla
 *   - SVE_CRIT, SVE_WARN, SVE_INFO, SVE_ICONS
 *     (features/validation/sve.js) — para renderizar el panel SVE
 *   - PulseBar (ui/pulse-bar.js) — pinta el resumen de salud del día
 *     en el topbar (Fase 1 del rediseño)
 *   - Events (events/events.js) — resuelto en tiempo de ejecución vía
 *     _setEvents(), ver nota abajo.
 *
 * FIX — dependencia circular UI ↔ Events:
 *   renderSVE() necesita llamar Events.handleForceExport() cuando el
 *   usuario confirma exportar con errores críticos, y el botón "✕" del
 *   catálogo (renderCatalog → delegación en app.js) necesita
 *   Events.delOp(). En el monolito original esto funcionaba porque
 *   Events vivía en el scope global del IIFE. Al modularizar, ui.js
 *   nunca importó Events — quedó roto silenciosamente (los clics no
 *   hacían nada, sin lanzar error visible al usuario).
 *
 *   events.js ya importa UI directamente a nivel superior, así que un
 *   `import { Events } from '../events/events.js'` estático en ui.js
 *   crearía un ciclo bidireccional real. Se resuelve con el mismo
 *   patrón de setter diferido ya usado entre EditSystem y RoutePicker:
 *   app.js llama _setEvents(Events) una vez, al arrancar, después de
 *   que ambos módulos ya terminaron de evaluarse.
 */
import { State } from '../core/state.js';
import { escH } from '../utils/dom.js';
import { fmtDate } from '../utils/format.js';
import {
  getMapped, COLS_PDF, COLS_DESP, COLS_FILL, PREVIEW_COLS
} from '../core/constants.js';
import { SVE_CRIT, SVE_WARN, SVE_INFO, SVE_ICONS } from '../features/validation/sve.js';
import { FactCache } from '../features/fact-cache.js';
import { PulseBar } from './pulse-bar.js';

let Events;
/** Resuelve la dependencia circular UI ↔ Events — llamado una vez desde core/app.js */
export function _setEvents(ev) { Events = ev; }

export const UI = {

  // ── Theme ──
  applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('sd_theme', t);
    State.theme = t;
    const btn = document.getElementById('btnTheme');
    if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
    document.getElementById('themeOptLight').classList.toggle('selected', t === 'light');
    document.getElementById('themeOptDark').classList.toggle('selected', t === 'dark');
  },
  selectTheme(t) { UI.applyTheme(t); },  // called by data-theme delegation in init

  // ── User ──
  setUser(name) {
    State.user = name || '';
    localStorage.setItem('sd_user', State.user);
    document.getElementById('tbUserName').textContent = State.user || '—';
  },

  // ── Modal ──
  // mode: 'setup' (first run, no skip) | 'settings' (user-triggered, has cancel)
  openModal(mode) {
    mode = mode || 'settings';
    State._modalMode = mode;
    document.getElementById('nameInput').value = State.user;
    // Sync theme opts to current theme
    document.getElementById('themeOptLight').classList.toggle('selected', State.theme === 'light');
    document.getElementById('themeOptDark').classList.toggle('selected', State.theme === 'dark');
    // Update copy based on mode
    if (mode === 'setup') {
      document.getElementById('modalTitle').textContent = '¡Bienvenido!';
      document.getElementById('modalSub').textContent = 'Configura tu sesión una sola vez. Esta información se guardará automáticamente.';
      document.getElementById('nameModalBtn').textContent = 'Guardar y comenzar →';
    } else {
      document.getElementById('modalTitle').textContent = 'Configuración de sesión';
      document.getElementById('modalSub').textContent = 'Actualiza tu nombre o el tema de la interfaz.';
      document.getElementById('nameModalBtn').textContent = 'Guardar cambios';
    }
    document.getElementById('nameModal').classList.remove('hidden');
    setTimeout(() => document.getElementById('nameInput').focus(), 80);
  },
  closeModal(name) {
    document.getElementById('nameModal').classList.add('hidden');
    if (name !== null) {
      UI.setUser(name);
      // Mark as configured so modal never shows again on load
      localStorage.setItem('sd_configured', '1');
    }
  },

  // ── Pipeline ──
  setPipeStep(n, state, stat) {
    const step = document.getElementById('pipeStep' + n);
    const num  = document.getElementById('pipeNum' + n);
    const stEl = document.getElementById('pipeStat' + n);
    step.className = 'pipe-step';
    if (state === 'done')      { step.classList.add('done');     num.textContent = '✓'; }
    else if (state === 'active')   { step.classList.add('active');   }
    else if (state === 'optional') { step.classList.add('optional'); }
    if (stat) stEl.textContent = stat;
  },

  // ── Pulse Bar (topbar) — Fase 1 del rediseño ──
  // Nombre público conservado (updateHealthRail) por compatibilidad con
  // todos los callers existentes — ver nota de cabecera del módulo.
  // Internamente arma los datos agregados del día y delega el pintado
  // a PulseBar.render(). nCrit/nWarn se leen de los contadores ocultos
  // del SVE (sveCrit/sveWarn), el mismo patrón que ya usa
  // events.js → handleForceExport() para leer esos valores.
  // CAMBIO Fase 5: también pasa State.operationalMode, para que la
  // PulseBar distinga 'arranque' de 'triage' en su mensaje idle.
  updateHealthRail() {
    const total   = State.merged.length || 0;
    const matched = State.merged.filter(r => r._matched).length;
    const nCrit   = parseInt(document.getElementById('sveCrit')?.textContent || '0', 10);
    const nWarn   = parseInt(document.getElementById('sveWarn')?.textContent || '0', 10);
    PulseBar.render({ total, matched, quality: State.sveLastQuality, nCrit, nWarn, mode: State.operationalMode });
  },

  // ── ModeSurface — Fase 5 del rediseño "Centro de Operaciones" ──
  // Aplica State.operationalMode como atributo data-mode en <body>.
  // Deliberadamente NO contiene lógica de negocio ni decide nada por sí
  // mismo — solo refleja el getter puro de State en el DOM. Todo el
  // comportamiento visual por modo vive en CSS (selectores
  // body[data-mode="..."] en index.html), siguiendo el mismo principio
  // que ya usamos en el resto de la app: UI pinta, no decide.
  //
  // Se llama junto a updateHealthRail() en los mismos puntos donde el
  // estado global ya se recalcula: triggerMerge() y
  // saveAndRevalidate() (vía events.js/edit-system.js),
  // refreshTodayBanner() (vía events.js), resetAll() (abajo) y el
  // bootstrap de core/app.js.
  applyMode() {
    document.body.dataset.mode = State.operationalMode;
  },

  // ── Stats strip ──
  // CAMBIO Fase 1: se retiraron los `set()` a stMatch/stNoMatch/stLic/
  // stDesp — esos elementos ya no existen en index.html (la PulseBar
  // resume esta información arriba). Todo lo demás de esta función
  // (badge de cache-hits, badges de la barra de acciones, previewDesc)
  // se conserva sin cambios.
  updateStats() {
    // Show cache-hit summary if any rows used historical data
    const cacheHits = State.merged.filter(r => r._factSource === 'cache').length;
    if (cacheHits > 0) {
      const fcStats = FactCache.stats();
      const badge   = document.getElementById('xlsBadge');
      if (badge) badge.innerHTML += ` · <span style="color:var(--amber-dk)">⟳ ${cacheHits} fact. históricas (${fcStats.dates[0]||''})</span>`;
    }

    const total = State.merged.length;
    const match = State.matchCount;
    const noM   = total - match;
    const desp  = State.despCount;

    // Badges
    const bdg = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    bdg('bdgPDF',     new Set([...State.pdfData.keys()].filter(k=>!k.includes('|D|'))).size || '—');
    bdg('bdgXLS',     State.xlsData ? State.xlsData.length : '—');
    bdg('bdgMatch',   match || '—');
    bdg('bdgNoMatch', noM);
    bdg('bdgDesp',    desp);

    document.getElementById('previewDesc').textContent = `${total} rutas · ${match} con PDF · ${State.licCount} con licencia`;
  },

  // ── Progress ──
  showProgress(label) {
    const bar = document.getElementById('progBar');
    bar.classList.add('on');
    document.getElementById('progLabel').textContent = label || 'Procesando…';
    document.getElementById('progFill').style.width  = '0%';
    document.getElementById('progPct').textContent   = '0%';
  },
  setProgress(v, total, name) {
    const p = Math.round(v / total * 100);
    document.getElementById('progFill').style.width = p + '%';
    document.getElementById('progPct').textContent  = p + '%';
    if (name) document.getElementById('progLabel').textContent = 'Procesando — ' + name;
  },
  hideProgress() { document.getElementById('progBar').classList.remove('on'); },

  // ── Error log ──
  showErrors(errors) {
    const log = document.getElementById('errLog');
    log.classList.add('on');
    document.getElementById('errLogInner').textContent = errors.join('\n');
  },
  clearErrors() {
    document.getElementById('errLog').classList.remove('on');
    document.getElementById('errLogInner').textContent = '';
  },

  // ── DZ state ──
  setDZDone(id, label) {
    const dz = document.getElementById(id);
    dz.classList.add('done');
    dz.querySelector('.dz-text').innerHTML = `<strong>✓ ${escH(label)}</strong>`;
  },
  resetDZ(id, ico, main, sub) {
    const dz = document.getElementById(id);
    dz.classList.remove('done','drag');
    dz.querySelector('.dz-ico').textContent  = ico;
    dz.querySelector('.dz-text').innerHTML   = main;
    dz.querySelector('.dz-sub').textContent  = sub;
  },
  setBadge(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent  = text;
    el.className    = 'dz-badge' + (cls ? ' ' + cls : '');
  },

  // ── Paste preview ──
  renderPastePreview(preview, idx) {
    const cols = ['RUTA'];
    if (idx.caseta !== undefined) cols.push('SALIDA CASETA');
    if (idx.wtms   !== undefined) cols.push('USUARIO WTMS');
    if (idx.idIda  !== undefined) cols.push('ID IDA');
    document.getElementById('ppHead').innerHTML = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
    document.getElementById('ppBody').innerHTML = preview.map(r => '<tr>' +
      [`<td>${escH(r.ruta)}</td>`,
       idx.caseta!==undefined?`<td>${escH(r.caseta)}</td>`:'',
       idx.wtms  !==undefined?`<td>${escH(r.wtms)}</td>`:'',
       idx.idIda !==undefined?`<td>${escH(r.idIda)}</td>`:''].join('') +
    '</tr>').join('');
    document.getElementById('pastePreview').classList.add('on');
  },
  setPasteSt(msg, cls) {
    const el = document.getElementById('pasteSt');
    el.className   = 'paste-status' + (cls ? ' ' + cls : '');
    el.textContent = msg;
  },

  // ── Table preview ──
  renderTable() {
    document.getElementById('thead').innerHTML = UI._previewTheadHtml();
    UI._renderRowsBody(State.merged, 'tbody');
    document.getElementById('legendRow').classList.add('on');
  },

  /**
   * HTML del <thead> de vista previa — compartido entre la tabla principal
   * (renderTable) y el preview del Historial de Procesamientos
   * (renderHistoryPreview), para no duplicar la lógica de columnas/colores.
   * @private
   */
  _previewTheadHtml() {
    return PREVIEW_COLS.map(c => {
      const cls = c==='RUTA' ? 'h-key' : COLS_PDF.has(c) ? 'h-pdf' : COLS_DESP.has(c) ? 'h-desp' : COLS_FILL.has(c) ? 'h-fill' : '';
      return `<th class="${cls}">${c.trim()}</th>`;
    }).join('');
  },

  /**
   * HTML del <tbody> de vista previa para un array arbitrario de rows
   * (mismo shape que State.merged) — compartido entre la tabla principal
   * y el preview del Historial de Procesamientos.
   * @private
   */
  _renderRowsBody(rows, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    const slice = rows.slice(0, 50);
    if (!slice.length) {
      tbody.innerHTML = '<tr><td colspan="22"><div class="empty-state"><div class="empty-ico">📂</div><div class="empty-title">Sin datos</div></div></td></tr>';
      return;
    }
    tbody.innerHTML = slice.map(row => {
      const cacheIndicator = row._factSource === 'cache'
        ? ` title="Datos de factura del ${row._factCacheDate||'día anterior'} (concentrado histórico)"`
        : '';
      return '<tr' + cacheIndicator + '>' + PREVIEW_COLS.map(c => {
        let val = getMapped(row, c);
        if (val instanceof Date) val = fmtDate(val);
        if (!row._matched && COLS_PDF.has(c)) return '<td><span class="no-data">—</span></td>';
        const cls = c==='RUTA' ? 'c-key' : COLS_PDF.has(c) ? 'c-pdf' : COLS_DESP.has(c) ? 'c-desp' : COLS_FILL.has(c) ? 'c-fill' : '';
        const isCacheField = row._factSource === 'cache' && (c === 'GLS DE EMB.' || c === 'HORA DE FACTURACION');
        const extraStyle   = isCacheField ? ` style="color:var(--amber-dk);opacity:.8" title="Fuente: concentrado histórico ${escH(row._factCacheDate||'')}"` : '';
        return `<td><span class="${cls}"${extraStyle}>${escH(String(val))}</span></td>`;
      }).join('') + '</tr>';
    }).join('');
  },

  // ── SVE ──
  // CAMBIO Fase 1: resetSVE() ahora también limpia los contadores
  // ocultos (sveCrit/sveWarn/sveInfo/svePass) a '0' — antes esto no
  // era necesario porque el ring/shield se repintaban siempre que
  // renderSVE() corría, pero ahora updateHealthRail() puede leer esos
  // contadores en cualquier momento (incluido después de un reset), así
  // que deben quedar consistentes con "sin datos" en vez de conservar
  // el último valor pintado.
  resetSVE() {
    document.getElementById('svePanel').classList.remove('on', 'expanded');
    document.getElementById('sveSummaryToggle').className = 'sve-summary-toggle';
    document.getElementById('sveSummaryIco').textContent  = '🛡️';
    document.getElementById('sveSummaryText').textContent = 'Sin incidencias detectadas';
    UI._resetSveCounters();
    State.sveHasCritical = false;
    State.sveHasWarnings = false;
    State.sveLastQuality = 100;
  },

  /** @private — ver nota en resetSVE() */
  _resetSveCounters() {
    ['sveCrit','sveWarn','sveInfo','svePass'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '0';
    });
  },

  renderSVE(issues, quality, nCrit, nWarn, nInfo, nPass) {
    const panel = document.getElementById('svePanel');
    panel.classList.add('on');

    // Contadores — SIGUEN en el DOM aunque ya no se muestren
    // visualmente (ver nota de cabecera del módulo): events.js y
    // warn-modal.js leen su textContent directamente.
    document.getElementById('sveCrit').textContent = nCrit;
    document.getElementById('sveWarn').textContent = nWarn;
    document.getElementById('sveInfo').textContent = nInfo;
    document.getElementById('svePass').textContent = nPass;

    // Barra de resumen (Fase 3) — única parte visible por defecto.
    // Reemplaza al antiguo shield+ring+subtitle del header eliminado
    // en la Fase 1, condensado en una sola línea.
    const summaryToggle = document.getElementById('sveSummaryToggle');
    const summaryIco    = document.getElementById('sveSummaryIco');
    const summaryText   = document.getElementById('sveSummaryText');
    let tier = 'ok';
    if (nCrit > 0) tier = 'crit'; else if (nWarn > 0) tier = 'warn';
    summaryToggle.className = 'sve-summary-toggle ' + tier;
    summaryIco.textContent  = nCrit > 0 ? '🚨' : nWarn > 0 ? '⚠️' : '🛡️';
    if (quality === 100) {
      summaryText.textContent = `Auditoría completada — todo en orden (calidad ${quality}%)`;
    } else if (nCrit > 0) {
      summaryText.textContent = `${nCrit} error${nCrit>1?'es':''} crítico${nCrit>1?'s':''} — exportación bloqueada`;
    } else if (nWarn > 0) {
      summaryText.textContent = `${nWarn} advertencia${nWarn>1?'s':''} — revisa antes de exportar (calidad ${quality}%)`;
    } else {
      summaryText.textContent = `Solo incidencias informativas — calidad ${quality}%`;
    }

    // Expandido/colapsado: un crítico siempre fuerza la expansión (no
    // se puede ocultar un bloqueo). Si no hay críticos, se conserva el
    // estado que el usuario ya tenía (este método se re-ejecuta en
    // cada guardado del drawer de edición — no debe cerrarle el panel
    // en plena revisión).
    const wasExpanded = panel.classList.contains('expanded');
    panel.classList.toggle('expanded', nCrit > 0 || wasExpanded);

    // Alerts
    const container = document.getElementById('sveAlerts');
    if (!issues.length) {
      container.innerHTML = '<div class="sve-empty-msg">✅ Sin incidencias detectadas — los datos lucen bien.</div>';
    } else {
      const groups = [
        { sev: SVE_CRIT, label:'Errores críticos',  cls:'sev-crit' },
        { sev: SVE_WARN, label:'Advertencias',       cls:'sev-warn' },
        { sev: SVE_INFO, label:'Informativas',        cls:'sev-info' },
      ];
      container.innerHTML = groups.map(g => {
        const items = issues.filter(i => i.sev === g.sev);
        if (!items.length) return '';
        const gid     = 'sveGrp_' + g.sev.replace(/[^a-z]/gi,'');
        const openCls = g.sev === SVE_CRIT ? ' open' : '';
        return `
          <div class="sve-group ${g.cls}${openCls}" id="${gid}">
            <div class="sve-group-hdr" onclick="document.getElementById('${gid}').classList.toggle('open')">
              <span class="sev-tag">${g.sev}</span>
              <span class="sve-group-name">${g.label}</span>
              <span class="sve-group-count">${items.length} incidencia${items.length>1?'s':''}</span>
              <span class="sve-group-chev">▾</span>
            </div>
            <div class="sve-group-body">
              ${items.map(it => `
                <div class="sve-issue">
                  <div class="sve-issue-ico">${SVE_ICONS[it.rule]||'🔎'}</div>
                  <div style="flex:1">
                    <div class="sve-issue-desc">${escH(it.desc)}</div>
                    <div class="sve-issue-meta">
                      ${it.ruta  ? `<span class="sve-tag-ruta">Ruta ${escH(it.ruta)}</span>` : ''}
                      ${it.field ? `<span class="sve-tag-field">${escH(it.field)}</span>`     : ''}
                      ${it.extra ? `<span class="sve-tag-extra">${escH(it.extra)}</span>`     : ''}
                      ${it.ruta && it.sev !== SVE_INFO ? `<button class="btn-locate" data-locate-ruta="${escH(it.ruta)}" data-locate-field="${escH(it.field)}" data-locate-ids="${escH(JSON.stringify(it.rowIds||[]))}">🔍 Localizar y corregir</button>` : ''}
                    </div>
                    ${it.action ? `<div class="sve-issue-action">→ ${escH(it.action)}</div>` : ''}
                  </div>
                </div>`).join('')}
            </div>
          </div>`;
      }).join('');
    }

    // Export gate — three states:
    //   critical  → gate visible (red), buttons blocked
    //   warn-only → gate visible (amber), buttons enabled, click triggers confirm modal
    //   clean     → gate hidden, buttons enabled, direct export
    const gate   = document.getElementById('exportGate');
    const btnExp = document.getElementById('btnExport');
    const btnExp2= document.getElementById('btnExport2');
    if (State.sveHasCritical) {
      gate.classList.remove('warn-only', 'forced');
      gate.classList.add('on');
      gate.innerHTML = `<div class="gate-msg">
        <strong>⚠ Exportación bloqueada</strong>
        <span>Existen errores críticos. Corrígelos antes de continuar, o acepta la responsabilidad.</span>
      </div>
      <button class="btn btn-danger-outline btn-sm" id="btnForceExport">Exportar de todas formas →</button>`;
      // Re-attach force-export listener (innerHTML replaced the node).
      // Events se resuelve en runtime vía _setEvents() — ver nota de cabecera.
      document.getElementById('btnForceExport').addEventListener('click', () => Events.handleForceExport());
      btnExp.disabled  = true;
      btnExp2.disabled = true;
    } else if (State.sveHasWarnings) {
      gate.classList.remove('on', 'forced');
      gate.classList.add('on', 'warn-only');
      gate.innerHTML = `<div class="gate-msg">
        <strong>Hay ${nWarn} advertencia${nWarn > 1 ? 's' : ''} pendiente${nWarn > 1 ? 's' : ''}</strong>
        <span>No bloquean la exportación. Puedes exportar ahora o revisarlas primero.</span>
      </div>`;
      btnExp.disabled  = false;
      btnExp2.disabled = false;
    } else {
      // Clean: no issues or info-only — gate hidden, export enabled immediately
      gate.classList.remove('on', 'warn-only', 'forced');
      btnExp.disabled  = false;
      btnExp2.disabled = false;
    }

    UI.updateHealthRail();
  },

  // ── Catalog ──
  renderCatalog() {
    const tbody = document.getElementById('catTbody');
    const cnt   = State.catalog.size;
    document.getElementById('catBadge').textContent = cnt + ' operador' + (cnt!==1?'es':'');
    if (!cnt) {
      tbody.innerHTML = '<tr><td colspan="3"><div class="cat-empty">Sin operadores — agrega o importa desde Excel</div></td></tr>';
      return;
    }
    tbody.innerHTML = [...State.catalog.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([op, lic]) => `
        <tr>
          <td class="td-op" title="${escH(op)}">${escH(op)}</td>
          <td class="td-lic">${escH(lic)}</td>
          <td><button class="btn-del" data-del-op="${escH(op)}">✕</button></td>
        </tr>`).join('');
    // FIX: antes era onclick="Events.delOp(...)" inline — referenciaba un
    // global que ya no existe tras la modularización (ver nota de cabecera).
    // Ahora expone data-del-op y la delegación vive en core/app.js.
  },
  setCatStatus(msg, cls) {
    const el = document.getElementById('catSt');
    el.className   = 'cat-status' + (cls ? ' ' + cls : '');
    el.textContent = msg;
  },
  // ── Catálogos Maestros (Camino C, Fase 3) ──
// ── Catálogos Maestros (Camino C, Fase 3) ──
  // FIX: antes dependía únicamente de State.catalogMeta, que solo se
  // escribe cuando el import pasa por el botón "Importar/Reemplazar".
  // Si los datos se cargaron directo en Supabase (CSV/SQL manual),
  // catalog_meta queda vacío legítimamente y el badge mentía diciendo
  // "Nunca cargado" aunque State.catalogs[catalogId] SÍ tuviera filas.
  // Ahora usa el conteo real de State.catalogs como fallback, así el
  // badge siempre refleja lo que la app puede usar de verdad para
  // enriquecer, sin importar cómo llegaron los datos ahí.
  renderCatalogMasterStatus(catalogId) {
    const elId = catalogId === 'ventanaRecibo' ? 'mcVentanaStatus' : 'mcPoolStatus';
    const el   = document.getElementById(elId);
    if (!el) return;
    const meta       = State.catalogMeta[catalogId];
    const loadedRows = (State.catalogs[catalogId] || []).length;

    if (meta) {
      const date = new Date(meta.updated_at).toLocaleString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      el.textContent = `✅ ${meta.row_count} registros · ${date}${meta.updated_by ? ' · ' + meta.updated_by : ''}`;
    } else if (loadedRows > 0) {
      el.textContent = `✅ ${loadedRows} registros (cargados directo en Supabase — sin fecha de actualización)`;
    } else {
      el.textContent = '⚠️ Nunca cargado';
    }
  },
  setMasterCatStatus(msg, cls) {
    const el = document.getElementById('mcStatus');
    if (!el) return;
    el.className   = 'cat-status' + (cls ? ' ' + cls : '');
    el.textContent = msg;
  },

  // ── Cache History ──
  // Panel de diagnóstico del FactCache — reutiliza las clases visuales
  // de .cat-panel (contenedor) y .sve-group (acordeón por fecha) que ya
  // existen en el CSS, para no agregar estilos nuevos salvo los 3
  // modificadores de badge (.warn/.err/.idle) documentados en index.html.
  renderCacheHistory() {
    const summary  = FactCache.dateSummary();
    const badge    = document.getElementById('cacheHistBadge');
    const list     = document.getElementById('cacheHistList');
    const totalInv = summary.reduce((s, d) => s + d.count, 0);

    if (State.cacheUpdating) {
      badge.textContent = '🔄 Actualizando…';
      badge.className   = 'cat-badge-count';
    } else if (!summary.length) {
      badge.textContent = '❌ Sin datos';
      badge.className   = 'cat-badge-count err';
    } else if (summary.some(d => d.status === 'err')) {
      badge.textContent = `⚠️ ${summary.length} día${summary.length > 1 ? 's' : ''} · revisar`;
      badge.className   = 'cat-badge-count warn';
    } else {
      badge.textContent = `✅ ${summary.length} día${summary.length > 1 ? 's' : ''} · ${totalInv} facturas`;
      badge.className   = 'cat-badge-count';
    }

    if (!summary.length) {
      list.innerHTML = '<div class="cat-empty">Sin caché guardado — carga un Excel con hoja de facturas para comenzar.</div>';
      return;
    }

    const fmtTs = ts => ts ? new Date(ts).toLocaleString('es-MX', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
    const STATUS_ICON  = { ok: '✅', warn: '⚠️', err: '❌' };
    const STATUS_LABEL = { ok: 'Disponible', warn: 'Sin registro de guardado', err: 'Error al guardar' };

    list.innerHTML = summary.map(d => {
      const gid = 'cacheDay_' + d.date.replace(/\D/g, '');
      return `
        <div class="sve-group" id="${gid}">
          <div class="sve-group-hdr" onclick="document.getElementById('${gid}').classList.toggle('open')">
            <span class="sve-issue-ico">${STATUS_ICON[d.status]}</span>
            <span class="sve-group-name">${escH(d.date)} — ${STATUS_LABEL[d.status]}</span>
            <span class="sve-group-count">${d.count} factura${d.count !== 1 ? 's' : ''}</span>
            <span class="sve-group-chev">▾</span>
          </div>
          <div class="sve-group-body">
            <div style="padding:8px 18px;font-size:10px;color:var(--text3);font-family:'JetBrains Mono',monospace">
              Generado: ${fmtTs(d.firstSavedAt)} · Última actualización: ${fmtTs(d.lastSavedAt)}
            </div>
            <div class="cat-table-wrap" style="margin:0 16px 12px">
              <table class="cat-table">
                <thead><tr><th>Factura</th><th>GLS</th><th>Hora facturación</th><th>Guardado</th></tr></thead>
                <tbody>
                  ${FactCache.entriesForDate(d.date).map(e => `
                    <tr>
                      <td class="td-op">${escH(e.invoice)}</td>
                      <td>${escH(e.gls)}</td>
                      <td>${escH(e.horaFact)}</td>
                      <td>${fmtTs(e.savedAt)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  // ── Buttons ──
  // Warnings never disable export — they trigger a confirmation modal instead.
  setActionsEnabled(on) {
    document.getElementById('btnExport').disabled  = !on || State.sveHasCritical;
    document.getElementById('btnExport2').disabled = !on || State.sveHasCritical;
    document.getElementById('btnAddPDF').disabled  = !on;
    document.getElementById('btnClear').disabled   = !on;
  },

  // ── Dispatch History (Camino B / Fase 3) ──

  /** Muestra "💾 Guardando…" en los botones de export mientras se persiste la sesión. */
  setExportBusy(isBusy) {
    ['btnExport', 'btnExport2'].forEach(id => {
      const btn = document.getElementById(id);
      if (!btn) return;
      if (isBusy) {
        btn.dataset.origText = btn.textContent;
        btn.textContent = '💾 Guardando…';
        btn.disabled = true;
      } else {
        if (btn.dataset.origText) btn.textContent = btn.dataset.origText;
        btn.disabled = State.sveHasCritical; // respeta el gate crítico al reactivar
      }
    });
  },

  /** Aviso "El día operativo de hoy ya fue procesado" — session=null lo oculta. */
  renderTodayBanner(session) {
    const banner = document.getElementById('todayBanner');
    if (!banner) return;
    if (!session) { banner.classList.add('hidden'); return; }
    banner.classList.remove('hidden');
    const time = session.finished_at
      ? new Date(session.finished_at).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' })
      : '—';
    document.getElementById('todayBannerInfo').innerHTML =
      `Procesado por: <strong>${escH(session.finished_by || session.created_by || '—')}</strong> · ` +
      `Hora: <strong>${escH(time)}</strong> · ${session.row_count} registros`;
  },

  /** Lista de sesiones para el panel "Historial de Procesamientos". */
  renderHistoryList(sessions) {
    const el = document.getElementById('historyList');
    if (!sessions.length) {
      el.innerHTML = '<div class="cat-empty">Sin procesamientos registrados todavía.</div>';
      return;
    }
    const STATUS_ICON  = { completed: '✅', processing: '⏳', error: '❌' };
    const STATUS_LABEL = { completed: '', processing: ' (en curso)', error: ' (falló al guardar)' };
    el.innerHTML = sessions.map(s => {
      const time = s.finished_at
        ? new Date(s.finished_at).toLocaleString('es-MX', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
        : new Date(s.started_at).toLocaleString('es-MX', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
      const clickable = s.status === 'completed';
      return `
        <div class="sve-issue"${clickable ? ` data-session-id="${escH(s.id)}" style="cursor:pointer"` : ''}>
          <div class="sve-issue-ico">${STATUS_ICON[s.status] || '❓'}</div>
          <div style="flex:1">
            <div class="sve-issue-desc">${escH(s.session_date)} — ${escH(time)}${STATUS_LABEL[s.status] || ''}</div>
            <div class="sve-issue-meta">
              <span class="sve-tag-ruta">${escH(s.created_by || 'desconocido')}</span>
              <span class="sve-tag-extra">${s.row_count} registros · calidad ${s.quality ?? '—'}%</span>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  /** Vista previa de una sesión seleccionada del historial. */
  renderHistoryPreview(rows, session) {
    document.getElementById('historyPreviewMeta').innerHTML =
      `${escH(session.session_date)} · Procesado por ${escH(session.created_by || '—')} · ` +
      `${rows.length} registros · calidad ${session.quality ?? '—'}%`;
    document.getElementById('histPreviewThead').innerHTML = UI._previewTheadHtml();
    UI._renderRowsBody(rows, 'histPreviewTbody');
  },

  // ── Reset everything ──
  // CAMBIO Fase 1: se retiró el bloque que reseteaba stMatch/stNoMatch/
  // stLic/stDesp (elementos eliminados de index.html). Todo lo demás
  // se conserva igual — incluyendo el reset de los badges de la barra
  // de acciones (bdgPDF/bdgXLS/bdgMatch/bdgNoMatch), que siguen vigentes.
  resetAll() {
    State.pdfData  = new Map();
    State.xlsData  = null;
    State.factData = new Map();
    State.despData = new Map();
    State.merged   = [];
    State.sveHasCritical = false;
    State.sveHasWarnings = false;
    State.sveLastQuality = 100;

    UI.resetDZ('dropPDF','☁️','<strong>Arrastra los PDFs aquí</strong> o haz clic','Todos los archivos del día a la vez');
    UI.resetDZ('dropXLS','📊','<strong>Arrastra el Excel macro</strong> o haz clic','Lee ambas pestañas automáticamente');
    UI.setBadge('pdfBadge', '● 0 archivos');
    UI.setBadge('xlsBadge', '● 0 rutas');

    ['bdgPDF','bdgXLS','bdgMatch','bdgNoMatch'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent='—'; });
    document.getElementById('bdgDesp').textContent = '0';

    document.getElementById('pasteArea').value = '';
    document.getElementById('pasteSt').textContent = '';
    document.getElementById('pastePreview').classList.remove('on');

    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '<tr><td colspan="22"><div class="empty-state"><div class="empty-ico">📂</div><div class="empty-title">Sin datos aún</div><div class="empty-desc">Carga los PDFs y el Excel macro para comenzar</div></div></td></tr>';
    document.getElementById('thead').innerHTML = '';
    document.getElementById('legendRow').classList.remove('on');
    document.getElementById('previewDesc').textContent = 'Carga los PDFs y el Excel macro para comenzar';

    UI.setPipeStep(1, 'active', 'En espera');
    UI.setPipeStep(2, '', 'En espera');
    UI.setPipeStep(3, 'optional', 'Opcional');
    document.getElementById('pipeNum1').textContent = '1';
    document.getElementById('pipeNum2').textContent = '2';

    document.getElementById('svePanel').classList.remove('on');
    UI._resetSveCounters();
    document.getElementById('exportGate').classList.remove('on','forced');
    UI.clearErrors();
    UI.hideProgress();
    UI.setActionsEnabled(false);
    UI.updateHealthRail();
    UI.applyMode();
  }
};
