/**
 * ui/ui.js
 * Objeto UI — única capa de manipulación del DOM en SmartDispatch.
 *
 * Todos los métodos reciben datos calculados y los pintan en el DOM.
 * Ningún método de UI debe tomar decisiones de negocio — eso es
 * responsabilidad de Events, EditSystem o los processors.
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

  // ── Health rail (topbar) ──
  updateHealthRail() {
    const { merged, pdfData } = State;
    const total = merged.length || 0;
    const match = merged.filter(r => r._matched).length;
    const q     = State.sveLastQuality;

    const pdfEl  = document.getElementById('hPDF');
    const covEl  = document.getElementById('hCov');
    const qualEl = document.getElementById('hQual');
    const stEl   = document.getElementById('hStatus');

    // PDFs
    const pdfCount = new Set([...pdfData.keys()].filter(k => !k.includes('|D|'))).size;
    pdfEl.textContent = pdfCount || '—';
    pdfEl.className   = 'health-pill-val ' + (pdfCount > 0 ? 'ok' : 'idle');

    // Coverage
    const covPct = total ? Math.round(match / total * 100) : null;
    covEl.textContent = covPct !== null ? covPct + '%' : '—';
    covEl.className   = 'health-pill-val ' + (covPct === null ? 'idle' : covPct === 100 ? 'ok' : covPct >= 70 ? 'warn' : 'crit');

    // Quality
    qualEl.textContent = total ? q + '%' : '—';
    qualEl.className   = 'health-pill-val ' + (!total ? 'idle' : q >= 90 ? 'ok' : q >= 60 ? 'warn' : 'crit');

    // Status
    if (!total) { stEl.textContent = 'En espera'; stEl.className = 'health-pill-val idle'; }
    else if (State.sveHasCritical) { stEl.textContent = '⚠ Bloqueado'; stEl.className = 'health-pill-val crit'; }
    else if (covPct === 100 && q >= 90) { stEl.textContent = '✓ Listo'; stEl.className = 'health-pill-val ok'; }
    else { stEl.textContent = 'Revisar'; stEl.className = 'health-pill-val warn'; }
  },

  // ── Stats strip ──
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
    const lic   = State.licCount;
    const desp  = State.despCount;
    const p     = (v) => total ? Math.round(v/total*100)+'%' : '0%';

    const set = (id, val, sub, cls) => {
      document.getElementById(id).textContent = val;
      const subEl = document.getElementById(id + 'Sub');
      if (subEl) { subEl.textContent = sub; subEl.className = 'stat-sub ' + cls; }
    };
    set('stMatch',   match, p(match) + ' del total',  match===total?'ok':'warn');
    set('stNoMatch', noM,   p(noM)   + ' del total',  noM===0?'ok':'warn');
    set('stLic',     lic,   p(lic)   + ' del total',  lic===total?'ok':'warn');
    set('stDesp',    desp,  p(desp)  + ' del total',  desp>0?'ok':'idle');

    // Badges
    const bdg = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
    bdg('bdgPDF',     new Set([...State.pdfData.keys()].filter(k=>!k.includes('|D|'))).size || '—');
    bdg('bdgXLS',     State.xlsData ? State.xlsData.length : '—');
    bdg('bdgMatch',   match || '—');
    bdg('bdgNoMatch', noM);
    bdg('bdgDesp',    desp);

    document.getElementById('previewDesc').textContent = `${total} rutas · ${match} con PDF · ${lic} con licencia`;
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
    const thead = document.getElementById('thead');
    const tbody = document.getElementById('tbody');

    thead.innerHTML = PREVIEW_COLS.map(c => {
      const cls = c==='RUTA' ? 'h-key' : COLS_PDF.has(c) ? 'h-pdf' : COLS_DESP.has(c) ? 'h-desp' : COLS_FILL.has(c) ? 'h-fill' : '';
      return `<th class="${cls}">${c.trim()}</th>`;
    }).join('');

    const rows = State.merged.slice(0, 50);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="22"><div class="empty-state"><div class="empty-ico">📂</div><div class="empty-title">Sin datos</div></div></td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((row, rowIdx) => {
      // Row-level indicator: cache-sourced fact data
      const cacheIndicator = row._factSource === 'cache'
        ? ` title="Datos de factura del ${row._factCacheDate||'día anterior'} (concentrado histórico)"`
        : '';
      return '<tr' + cacheIndicator + '>' + PREVIEW_COLS.map(c => {
        let val = getMapped(row, c);
        if (val instanceof Date) val = fmtDate(val);
        if (!row._matched && COLS_PDF.has(c)) return '<td><span class="no-data">—</span></td>';
        const cls = c==='RUTA' ? 'c-key' : COLS_PDF.has(c) ? 'c-pdf' : COLS_DESP.has(c) ? 'c-desp' : COLS_FILL.has(c) ? 'c-fill' : '';
        // GLS / HORA_FACT from cache: add subtle amber tint
        const isCacheField = row._factSource === 'cache' && (c === 'GLS DE EMB.' || c === 'HORA DE FACTURACION');
        const extraStyle   = isCacheField ? ` style="color:var(--amber-dk);opacity:.8" title="Fuente: concentrado histórico ${escH(row._factCacheDate||'')}"` : '';
        return `<td><span class="${cls}"${extraStyle}>${escH(String(val))}</span></td>`;
      }).join('') + '</tr>';
    }).join('');

    document.getElementById('legendRow').classList.add('on');
  },

  // ── SVE ──
  resetSVE() {
    document.getElementById('svePanel').classList.remove('on');
    State.sveHasCritical = false;
    State.sveHasWarnings = false;
    State.sveLastQuality = 100;
  },
  renderSVE(issues, quality, nCrit, nWarn, nInfo, nPass) {
    const panel = document.getElementById('svePanel');
    panel.classList.add('on');

    // Ring
    const CIRC = 175.9;
    const fill = document.getElementById('ringFill');
    fill.style.strokeDashoffset = CIRC - (CIRC * quality / 100);
    const ring  = document.getElementById('sveRing');
    ring.className = 'sve-ring ' + (quality===100?'q-100':quality>=80?'q-high':quality>=50?'q-med':'q-low');
    document.getElementById('ringPct').textContent = quality + '%';

    // Counters
    document.getElementById('sveCrit').textContent = nCrit;
    document.getElementById('sveWarn').textContent = nWarn;
    document.getElementById('sveInfo').textContent = nInfo;
    document.getElementById('svePass').textContent = nPass;

    // Shield
    const shield = document.getElementById('sveShield');
    shield.className = 'sve-shield-wrap ' + (nCrit>0?'crit':nWarn>0?'warn':'ok');
    shield.textContent = nCrit>0 ? '🚨' : nWarn>0 ? '⚠️' : '🛡️';

    // Subtitle
    const sub = document.getElementById('sveSubtitle');
    if (quality===100) sub.textContent = 'Auditoría completada — todos los datos superaron las validaciones.';
    else if (nCrit>0)  sub.textContent = `${nCrit} error${nCrit>1?'es':''} crítico${nCrit>1?'s':''} detectado${nCrit>1?'s':''} — exportación bloqueada hasta corregir.`;
    else if (nWarn>0)  sub.textContent = `${nWarn} advertencia${nWarn>1?'s':''} — revisa antes de exportar.`;
    else               sub.textContent = 'Solo incidencias informativas — puedes exportar con seguridad.';

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

  // ── Buttons ──
  // Warnings never disable export — they trigger a confirmation modal instead.
  setActionsEnabled(on) {
    document.getElementById('btnExport').disabled  = !on || State.sveHasCritical;
    document.getElementById('btnExport2').disabled = !on || State.sveHasCritical;
    document.getElementById('btnAddPDF').disabled  = !on;
    document.getElementById('btnClear').disabled   = !on;
  },

  // ── Reset everything ──
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

    ['stMatch','stNoMatch','stLic','stDesp'].forEach(id => {
      document.getElementById(id).textContent = '—';
      const sub = document.getElementById(id + 'Sub'); if (sub) { sub.textContent = '—'; sub.className = 'stat-sub idle'; }
    });
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
    document.getElementById('exportGate').classList.remove('on','forced');
    UI.clearErrors();
    UI.hideProgress();
    UI.setActionsEnabled(false);
    UI.updateHealthRail();
  }
};
