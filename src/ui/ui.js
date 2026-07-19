/**
 * ui/ui.js
 * Objeto UI — única capa de manipulación del DOM en SmartDispatch.
 *
 * Todos los métodos reciben datos calculados y los pintan en el DOM.
 * Ningún método de UI debe tomar decisiones de negocio — eso es
 * responsabilidad de Events, EditSystem o los processors.
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   - Nuevo método renderSourceGate(missing) — pinta/oculta el banner
 *     de bloqueo "Faltan fuentes obligatorias" (#sourceGate en
 *     index.html). Llamado desde Events.triggerMerge().
 *   - resetAll() ahora también limpia State.wtmsData, el dropzone
 *     #dropWTMS, el badge wtmsBadge, y refleja el pipeline de 4 pasos
 *     (antes 3) — el Status de despacho deja de tener estado
 *     "optional" en el pipeline visual, ya que ahora es obligatorio.
 *   - setActionsEnabled() no cambia de firma ni de lógica interna —
 *     sigue siendo el único lugar que calcula el disabled real de los
 *     botones de exportar (combinando el flag `on` que le pasan con
 *     State.sveHasCritical). Events.triggerMerge() es ahora quien
 *     decide CUÁNDO llamarla con true/false según checkSources().
 *
 * CAMBIO — Fase 1 del rediseño "Centro de Operaciones" (PulseBar):
 *   ver notas previas conservadas en updateHealthRail()/updateStats().
 *
 * Dependencias:
 *   - State (core/state.js)
 *   - escH (utils/dom.js)
 *   - fmtDate (utils/format.js)
 *   - getMapped, COLS_PDF, COLS_DESP, COLS_FILL, PREVIEW_COLS (core/constants.js)
 *   - SVE_CRIT, SVE_WARN, SVE_INFO, SVE_ICONS (features/validation/sve.js)
 *   - PulseBar (ui/pulse-bar.js)
 *   - Events (events/events.js) — resuelto en tiempo de ejecución vía
 *     _setEvents(), ver nota abajo.
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
  selectTheme(t) { UI.applyTheme(t); },

  // ── User ──
  setUser(name) {
    State.user = name || '';
    localStorage.setItem('sd_user', State.user);
    document.getElementById('tbUserName').textContent = State.user || '—';
  },

  // ── Modal ──
  openModal(mode) {
    mode = mode || 'settings';
    State._modalMode = mode;
    document.getElementById('nameInput').value = State.user;
    document.getElementById('themeOptLight').classList.toggle('selected', State.theme === 'light');
    document.getElementById('themeOptDark').classList.toggle('selected', State.theme === 'dark');
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

  // ── Source Gate — NUEVO (fuentes obligatorias) ──
  // Pinta/oculta el banner de bloqueo cuando falta cualquiera de las
  // 4 fuentes (ver Events.checkSources()). missing=[] lo oculta.
  renderSourceGate(missing) {
    const el = document.getElementById('sourceGate');
    if (!el) return;
    if (!missing || !missing.length) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    document.getElementById('sourceGateList').innerHTML =
      missing.map(m => `<li>${escH(m)}</li>`).join('');
  },

  // ── Pulse Bar (topbar) — Fase 1 del rediseño ──
  updateHealthRail() {
    const total   = State.merged.length || 0;
    const matched = State.merged.filter(r => r._matched).length;
    const nCrit   = parseInt(document.getElementById('sveCrit')?.textContent || '0', 10);
    const nWarn   = parseInt(document.getElementById('sveWarn')?.textContent || '0', 10);
    PulseBar.render({ total, matched, quality: State.sveLastQuality, nCrit, nWarn, mode: State.operationalMode });
  },

  // ── ModeSurface — Fase 5 del rediseño "Centro de Operaciones" ──
  applyMode() {
    document.body.dataset.mode = State.operationalMode;
  },

  // ── Stats strip ──
  updateStats() {
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
    if (idx.idIda  !== undefined) cols.push("ID'S MASTER");
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

  _previewTheadHtml() {
    return PREVIEW_COLS.map(c => {
      const cls = c==='RUTA' ? 'h-key' : COLS_PDF.has(c) ? 'h-pdf' : COLS_DESP.has(c) ? 'h-desp' : COLS_FILL.has(c) ? 'h-fill' : '';
      return `<th class="${cls}">${c.trim()}</th>`;
    }).join('');
  },

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

  _resetSveCounters() {
    ['sveCrit','sveWarn','sveInfo','svePass'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '0';
    });
  },

  renderSVE(issues, quality, nCrit, nWarn, nInfo, nPass) {
    const panel = document.getElementById('svePanel');
    panel.classList.add('on');

    document.getElementById('sveCrit').textContent = nCrit;
    document.getElementById('sveWarn').textContent = nWarn;
    document.getElementById('sveInfo').textContent = nInfo;
    document.getElementById('svePass').textContent = nPass;

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

    const wasExpanded = panel.classList.contains('expanded');
    panel.classList.toggle('expanded', nCrit > 0 || wasExpanded);

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
  },
  setCatStatus(msg, cls) {
    const el = document.getElementById('catSt');
    el.className   = 'cat-status' + (cls ? ' ' + cls : '');
    el.textContent = msg;
  },

  // ── Catálogos Maestros (Camino C, Fase 3) ──
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
  setActionsEnabled(on) {
    document.getElementById('btnExport').disabled  = !on || State.sveHasCritical;
    document.getElementById('btnExport2').disabled = !on || State.sveHasCritical;
    document.getElementById('btnAddPDF').disabled  = !on;
    document.getElementById('btnClear').disabled   = !on;
  },

  // ── Dispatch History (Camino B / Fase 3) ──
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
        btn.disabled = State.sveHasCritical;
      }
    });
  },

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

  renderHistoryPreview(rows, session) {
    document.getElementById('historyPreviewMeta').innerHTML =
      `${escH(session.session_date)} · Procesado por ${escH(session.created_by || '—')} · ` +
      `${rows.length} registros · calidad ${session.quality ?? '—'}%`;
    document.getElementById('histPreviewThead').innerHTML = UI._previewTheadHtml();
    UI._renderRowsBody(rows, 'histPreviewTbody');
  },

  // ── Reset everything ──
  // CAMBIO WTMS: se agrega reset de State.wtmsData + dropzone/badge de
  // WTMS, y el pipeline se resetea a sus 4 pasos (ninguno "optional" —
  // Status y WTMS son obligatorios ahora). renderSourceGate([]) oculta
  // el gate — vuelve a mostrarse cuando el usuario empiece a cargar
  // fuentes de nuevo (ver Events.triggerMerge()).
  resetAll() {
    State.pdfData  = new Map();
    State.xlsData  = null;
    State.factData = new Map();
    State.despData = new Map();
    State.wtmsData = new Map();
    State.merged   = [];
    State.sveHasCritical = false;
    State.sveHasWarnings = false;
    State.sveLastQuality = 100;

    UI.resetDZ('dropPDF','☁️','<strong>Arrastra los PDFs aquí</strong> o haz clic','Todos los archivos del día a la vez');
    UI.resetDZ('dropXLS','📊','<strong>Arrastra el Excel macro</strong> o haz clic','Lee ambas pestañas automáticamente');
    UI.resetDZ('dropWTMS','🛰️','<strong>Arrastra el Reporte WTMS</strong> o haz clic','Archivo .csv exportado de WTMS');
    UI.setBadge('pdfBadge', '● 0 archivos');
    UI.setBadge('xlsBadge', '● 0 rutas');
    UI.setBadge('wtmsBadge', '● 0 cargas');

    ['bdgPDF','bdgXLS','bdgMatch','bdgNoMatch'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent='—'; });
    document.getElementById('bdgDesp').textContent = '0';

    document.getElementById('pasteArea').value = '';
    document.getElementById('pasteSt').textContent = '';
    document.getElementById('pastePreview').classList.remove('on');

    const tbody = document.getElementById('tbody');
    tbody.innerHTML = '<tr><td colspan="22"><div class="empty-state"><div class="empty-ico">📂</div><div class="empty-title">Sin datos aún</div><div class="empty-desc">Carga las 4 fuentes obligatorias para comenzar</div></div></td></tr>';
    document.getElementById('thead').innerHTML = '';
    document.getElementById('legendRow').classList.remove('on');
    document.getElementById('previewDesc').textContent = 'Carga las 4 fuentes obligatorias para comenzar';

    UI.setPipeStep(1, 'active', 'En espera');
    UI.setPipeStep(2, '', 'En espera');
    UI.setPipeStep(3, '', 'En espera');
    UI.setPipeStep(4, '', 'En espera');
    document.getElementById('pipeNum1').textContent = '1';
    document.getElementById('pipeNum2').textContent = '2';
    document.getElementById('pipeNum3').textContent = '3';
    document.getElementById('pipeNum4').textContent = '4';

    document.getElementById('svePanel').classList.remove('on');
    UI._resetSveCounters();
    document.getElementById('exportGate').classList.remove('on','forced');
    UI.renderSourceGate([]);
    UI.clearErrors();
    UI.hideProgress();
    UI.setActionsEnabled(false);
    UI.updateHealthRail();
    UI.applyMode();
  }
};
