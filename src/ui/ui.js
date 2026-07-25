/**
 * ui/ui.js
 * Objeto UI — única capa de manipulación del DOM en SmartDispatch.
 *
 * Todos los métodos reciben datos calculados y los pintan en el DOM.
 * Ningún método de UI debe tomar decisiones de negocio — eso es
 * responsabilidad de Events, EditSystem o los processors.
 *
 * ═══════════════════════════════════════════════════════════════════
 * CAMBIO — Rediseño Preparación / Mesa de Trabajo (mockup, jul-2026)
 * ═══════════════════════════════════════════════════════════════════
 * Este rediseño reemplaza dos superficies del HTML anterior:
 *
 *  1) La barra de pipeline (3-4 pasos, #pipeStep1..4) + los badges
 *     sueltos de cada fuente (#pdfBadge/#xlsBadge/#bdgDesp) → AHORA
 *     son 4 "up-card" en la pantalla Preparación (#dropPDF/#dropXLS/
 *     #dropWTMS/#dropDESP), cada una actualizada por UN solo método
 *     nuevo: setSourceStatus(key, done, statusText, subText). Los
 *     métodos anteriores (setPipeStep, setBadge, setDZDone, resetDZ)
 *     SE ELIMINAN — sus IDs de destino no existen en el nuevo HTML, y
 *     dejarlos habría sido código muerto.
 *
 *  2) La tabla de vista previa (#tbody/#thead, columnas PREVIEW_COLS
 *     con codificación de color por fuente) → AHORA es la tabla de la
 *     Mesa de Trabajo (#mainTbody), fiel al mockup: columnas
 *     WORKTABLE_COLS (core/constants.js) + una columna de Estado
 *     (pill Completa/Advertencia/Crítica/Corregida, derivada de
 *     State.sveIssues + State.edits, no de getMapped) + búsqueda y
 *     chips de filtro. renderTable() sigue siendo el nombre público
 *     (mismo contrato, llamado desde events.js/edit-system.js) pero
 *     su implementación interna cambia por completo.
 *
 *     _previewTheadHtml()/_renderRowsBody() (el renderer ANTERIOR)
 *     NO se eliminan — siguen siendo usados exclusivamente por
 *     renderHistoryPreview() (modal de Historial), que conserva su
 *     diseño de tabla anterior sin cambios en esta fase.
 *
 * Se retira además el uso de PulseBar en updateHealthRail() — su rol
 * ("salud del día de un vistazo" en el topbar) lo cubrirá el Quality
 * Ring de la futura pantalla "Calidad" del mockup, todavía no
 * construida. updateHealthRail() se conserva como método (lo siguen
 * llamando ~6 call-sites) pero por ahora es un stub documentado.
 *
 * Dependencias:
 *   - State (core/state.js)
 *   - escH (utils/dom.js)
 *   - fmtDate (utils/format.js) — usado por _renderRowsBody() (historial)
 *   - getMapped, COLS_PDF, COLS_DESP, COLS_FILL, PREVIEW_COLS,
 *     WORKTABLE_COLS (core/constants.js)
 *   - SVE_CRIT, SVE_WARN, SVE_INFO, SVE_ICONS (features/validation/sve.js)
 *   - FactCache (features/fact-cache.js)
 *   - Events (events/events.js) — resuelto en runtime vía _setEvents()
 */
import { State } from '../core/state.js';
import { escH } from '../utils/dom.js';
import { fmtDate } from '../utils/format.js';
import {
  getMapped, COLS_PDF, COLS_DESP, COLS_FILL, PREVIEW_COLS, WORKTABLE_COLS
} from '../core/constants.js';
import { SVE_CRIT, SVE_WARN, SVE_INFO, SVE_ICONS } from '../features/validation/sve.js';
import { FactCache } from '../features/fact-cache.js';

let Events;
/** Resuelve la dependencia circular UI ↔ Events — llamado una vez desde core/app.js */
export function _setEvents(ev) { Events = ev; }

// ── Estado puramente de presentación de la Mesa de Trabajo ──
// Deliberadamente NO vive en core/state.js: es UI state (qué filtro/
// búsqueda tiene aplicado el usuario ahora mismo), no dato de negocio.
// Se resetea junto con el resto en UI.resetAll().
let _tableFilter = 'all';
let _tableSearch = '';

// ── Correcciones — clasificación de incidencias (NUEVO, mockup jul-2026) ──
// Reglas cuyo issue mapea 1:1 a UN solo campo editable — candidatas a
// tarjeta de "corrección rápida" (input inline). Cualquier otra regla
// CRÍTICA/ADVERTENCIA (dup_march, no_pdf, wtms_ambiguous, no_ventana,
// no_pool, cat_dup) se muestra como tarjeta "Revisar", que abre el
// drawer completo — no tienen un único campo+valor claro que resolver
// con un input suelto. Ver features/validation/sve.js para el porqué
// de cada field.
const QUICKFIX_RULES = new Set(['missing', 'no_march', 'zero_tar', 'high_tar']);
const QUICKFIX_FIELD_MAP = {
  'OPERADOR':   { key: 'OPERADOR',   label: 'Operador',   placeholder: 'Nombre del operador…' },
  'LIC.':       { key: '_LIC',       label: 'Licencia',   placeholder: 'Número de licencia…' },
  'TARIMAS':    { key: 'TARIMAS',    label: 'Tarimas',    placeholder: 'Cantidad de tarimas…' },
  'MARCHAMO 1': { key: 'MARCHAMO 1', label: 'Marchamo 1', placeholder: 'Número de marchamo…' },
  'CITA':       { key: 'CITA',       label: 'Cita',       placeholder: 'DD/MM/AAAA HH:MM' },
};
// Total "pico" de incidencias accionables desde el último merge completo
// — referencia para la barra de progreso de Correcciones (% resuelto
// dentro de ESTA sesión de corrección). null = sin baseline todavía;
// se fija la primera vez que renderFixList() corre tras un merge nuevo
// (ver UI.resetFixPeak(), llamado desde Events.triggerMerge()).
let _fixPeakTotal = null;

// Mapea la clave de fuente ('pdf'|'xls'|'wtms'|'desp') al sufijo de
// IDs usado en el HTML de Preparación (#dropPDF/#pdfSub/#pdfStatus, etc).
const SOURCE_ID = { pdf: 'PDF', xls: 'XLS', wtms: 'WTMS', desp: 'DESP' };

export const UI = {

  // ── Theme ──
  applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('sd_theme', t);
    State.theme = t;
    const btn = document.getElementById('btnTheme');
    if (btn) { btn.textContent = t === 'dark' ? '☀️' : '🌙'; btn.classList.toggle('on', t === 'dark'); }
    const optLight = document.getElementById('themeOptLight');
    const optDark  = document.getElementById('themeOptDark');
    if (optLight) optLight.classList.toggle('selected', t === 'light');
    if (optDark)  optDark.classList.toggle('selected', t === 'dark');
  },
  selectTheme(t) { UI.applyTheme(t); },

  // ── User ──
  setUser(name) {
    State.user = name || '';
    localStorage.setItem('sd_user', State.user);
    const nameEl = document.getElementById('tbUserName');
    if (nameEl) nameEl.textContent = State.user || '—';
    const avatarEl = document.getElementById('tbAvatar');
    if (avatarEl) {
      const initials = String(State.user || '')
        .trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
      avatarEl.textContent = initials || '—';
    }
  },

  // ── Modal (nombre + tema) ──
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

  // ═══════════════════════════════════════════════════════════════
  // ── PREPARACIÓN — tarjetas de fuente (NUEVO, reemplaza pipeline) ──
  // ═══════════════════════════════════════════════════════════════

  /**
   * Actualiza una tarjeta de fuente en la pantalla Preparación.
   * @param {string} key — 'pdf'|'xls'|'wtms'|'desp'
   * @param {boolean} done — true = fuente cargada (tarjeta en verde)
   * @param {string} statusText — texto corto (ej. '✓ Completo')
   * @param {string} subText — detalle (ej. '42 archivos · 238 entregas')
   */
  setSourceStatus(key, done, statusText, subText) {
    const suffix = SOURCE_ID[key];
    if (!suffix) return;
    const card   = document.getElementById('drop' + suffix);
    const status = document.getElementById(key + 'Status');
    const sub    = document.getElementById(key + 'Sub');
    if (card)   card.classList.toggle('done', !!done);
    if (status) status.textContent = statusText;
    if (sub)    sub.textContent    = subText;
  },

  /** Agrega una nota adicional (ej. aviso de caché histórico) al sub-texto de una fuente, sin pisar el texto principal. */
  appendSourceNote(key, note) {
    const sub = document.getElementById(key + 'Sub');
    if (!sub || !note) return;
    sub.innerHTML += ` · <span style="color:var(--amber-deep)">${note}</span>`;
  },

  /**
   * Colapsa/expande la grilla de Preparación según falten fuentes o no.
   * @param {string[]} missing — salida de Events.checkSources().missing
   */
  updatePrepView(missing) {
    const grid      = document.getElementById('prepGrid');
    const collapsed = document.getElementById('prepCollapsed');
    if (!grid || !collapsed) return;
    const allDone = missing.length === 0;
    grid.style.display      = allDone ? 'none' : '';
    collapsed.style.display = allDone ? '' : 'none';
    if (!allDone) return;

    const chipsEl = document.getElementById('prepChips');
    if (!chipsEl) return;
    const pdfCount  = new Set([...State.pdfData.keys()].filter(k => !k.includes('|D|'))).size;
    const xlsCount  = State.xlsData ? State.xlsData.length : 0;
    const wtmsCount = State.wtmsData.size;
    const despCount = State.despData.size;
    chipsEl.innerHTML = `
      <span class="chip ok">📄 ${pdfCount} PDFs</span>
      <span class="chip ok">📊 ${xlsCount} rutas</span>
      <span class="chip ok">🛰️ ${wtmsCount} WTMS</span>
      <span class="chip ok">📋 ${despCount} despacho</span>`;
    const timeEl = document.getElementById('prepCollapsedTime');
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
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

  // ── Paste preview (Status de despacho) ──
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

  // ═══════════════════════════════════════════════════════════════
  // ── MESA DE TRABAJO — tabla principal (REESCRITO, mockup) ──
  // ═══════════════════════════════════════════════════════════════

  /**
   * Construye rowId → 'crit'|'warn'|'fixed'|'ok' para el status pill de
   * cada fila. Un solo paso sobre issues + edits — barato incluso con
   * cientos de filas/decenas de incidencias.
   * @private
   */
  _buildRowStatusMap(rows) {
    const map = new Map();
    rows.forEach(r => map.set(r._rowId, 'ok'));
    (State.sveIssues || []).forEach(issue => {
      if (issue.sev !== SVE_CRIT && issue.sev !== SVE_WARN) return;
      (issue.rowIds || []).forEach(rid => {
        if (!map.has(rid)) return;
        if (issue.sev === SVE_CRIT) map.set(rid, 'crit');
        else if (map.get(rid) !== 'crit') map.set(rid, 'warn');
      });
    });
    const editedIds = new Set((State.edits || []).map(e => e.rowId));
    editedIds.forEach(rid => { if (map.get(rid) === 'ok') map.set(rid, 'fixed'); });
    return map;
  },

  /** Aplica búsqueda de texto + filtro de estado sobre State.merged. @private */
  _filteredRows(statusMap) {
    let rows = State.merged;
    if (_tableSearch) {
      const q = _tableSearch.toLowerCase();
      rows = rows.filter(r => {
        const hay = [
          getMapped(r,'RUTA'), getMapped(r,'FAC.'), r['TIENDA'],
          getMapped(r,'OPERADOR'), getMapped(r,'TRACTOR ')
        ].map(v => String(v||'').toLowerCase());
        return hay.some(v => v.includes(q));
      });
    }
    if (_tableFilter !== 'all') {
      rows = rows.filter(r => statusMap.get(r._rowId) === _tableFilter);
    }
    return rows;
  },

  /** Cambia el filtro activo de la toolbar y re-pinta solo el cuerpo de la tabla. */
  setTableFilter(key) {
    _tableFilter = key;
    UI._renderTableBody();
  },
  /** Cambia el texto de búsqueda de la toolbar y re-pinta solo el cuerpo de la tabla. */
  setTableSearch(text) {
    _tableSearch = String(text || '');
    UI._renderTableBody();
  },

  /** Renderiza la tabla completa de Mesa de Trabajo (thead es estático en el HTML — solo se genera el tbody). */
  renderTable() {
    UI._renderTableBody();
  },

  /** @private */
  _renderTableBody() {
    const tbody = document.getElementById('mainTbody');
    if (!tbody) return;

    const statusMap = UI._buildRowStatusMap(State.merged);
    UI._renderFilterChips(statusMap);

    const { ok } = Events ? Events.checkSources() : { ok: true };
    if (!State.merged.length) {
      const msg = !ok
        ? 'Faltan fuentes por cargar — vuelve a Preparación'
        : 'Sin datos aún';
      tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state">
        <div class="empty-ico">📂</div><div class="empty-title">${escH(msg)}</div>
      </div></td></tr>`;
      return;
    }

    const rows = UI._filteredRows(statusMap);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state">
        <div class="empty-ico">🔍</div><div class="empty-title">Sin resultados para este filtro</div>
      </div></td></tr>`;
      return;
    }

    const STATUS_MAP = {
      ok:    ['status-pill ok',    'Completa'],
      warn:  ['status-pill warn',  'Advertencia'],
      crit:  ['status-pill crit',  'Crítica'],
      fixed: ['status-pill fixed', 'Corregida'],
    };

    tbody.innerHTML = rows.slice(0, 500).map(row => {
      const st = statusMap.get(row._rowId) || 'ok';
      const [cls, label] = STATUS_MAP[st];
      const cell = col => {
        const v = getMapped(row, col);
        if (!row._matched && COLS_PDF.has(col)) return '<span class="dim">—</span>';
        const s = String(v ?? '').trim();
        return s ? escH(s) : '<span class="dim">—</span>';
      };
      const ruta = String(row['RUTA'] || '').trim();
      return `<tr>
        <td class="rt">${escH(ruta)}</td>
        <td>${cell('OPERADOR')}</td>
        <td>${cell('LIC.')}</td>
        <td>${cell('TARIMAS')}</td>
        <td>${cell('MARCHAMO 1')}</td>
        <td>${cell('FAC.')}</td>
        <td>${cell('TIENDA')}</td>
        <td>${cell('TRACTOR ')}</td>
        <td>${cell('REMOLQUE')}</td>
        <td><span class="${cls}">${label}</span></td>
        <td><button class="row-edit-btn" data-edit-ruta="${escH(ruta)}" data-edit-rowid="${escH(row._rowId)}">✎</button></td>
      </tr>`;
    }).join('');
  },

  /** @private */
  _renderFilterChips(statusMap) {
    const bar = document.getElementById('filterChips');
    if (!bar) return;
    const total = State.merged.length;
    let crit = 0, warn = 0, fixed = 0;
    statusMap.forEach(st => {
      if (st === 'crit') crit++; else if (st === 'warn') warn++; else if (st === 'fixed') fixed++;
    });
    const ok = total - crit - warn - fixed;
    const DEFS = [
      { key: 'all',   label: 'Todas',           cnt: total },
      { key: 'crit',  label: 'Con errores',      cnt: crit  },
      { key: 'warn',  label: 'Datos faltantes',  cnt: warn  },
      { key: 'fixed', label: 'Corregidas',       cnt: fixed },
      { key: 'ok',    label: 'Completas',        cnt: ok    },
    ];
    bar.innerHTML = DEFS.map(d => `
      <button class="fchip${d.key === _tableFilter ? ' active' : ''}" data-filter="${d.key}">
        ${d.label} <span class="cnt">${d.cnt}</span>
      </button>`).join('');
  },

  /** Sub-título de la pantalla Mesa de Trabajo — "N rutas del día operativo · actualizado HH:MM" */
  _updateWorktableSub() {
    const el = document.getElementById('worktableSub');
    if (!el) return;
    const total = State.merged.length;
    if (!total) { el.textContent = 'Carga las 4 fuentes en Preparación para comenzar.'; return; }
    const time = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `${total} rutas del día operativo · actualizado ${time}`;
  },

  // ── Stats (contadores internos — ya no hay badges de acción sueltos) ──
  updateStats() {
    const cacheHits = State.merged.filter(r => r._factSource === 'cache').length;
    if (cacheHits > 0) {
      const fcStats = FactCache.stats();
      UI.appendSourceNote('xls', `⟳ ${cacheHits} fact. históricas (${fcStats.dates[0] || ''})`);
    }
    UI._updateWorktableSub();
  },

  // ═══════════════════════════════════════════════════════════════
  // ── CORRECCIONES — pantalla dedicada (NUEVO, mockup jul-2026) ──
  // ═══════════════════════════════════════════════════════════════

  /** Reinicia el baseline de la barra de progreso — llamar tras un merge completo (Events.triggerMerge), NUNCA tras una edición individual (revalidateAfterEdit), para que el progreso avance dentro de la sesión de corrección en vez de resetearse con cada guardado. */
  resetFixPeak() { _fixPeakTotal = null; },

  /**
   * Clasifica las incidencias accionables (CRÍTICA/ADVERTENCIA) de
   * State.sveIssues en "corrección rápida" (un campo editable claro) vs
   * "revisar" (todo lo demás — necesita el drawer completo). CITA
   * (no_cita) es siempre INFORMATIVA — nunca entra en `quick`/`review`,
   * se devuelve aparte en `info` y no cuenta para el contador de
   * "incidencias pendientes" (decisión confirmada con EduarDo).
   * @private
   */
  _buildFixBuckets() {
    const issues = State.sveIssues || [];
    const quick = [], review = [];
    issues.forEach(issue => {
      if (issue.sev !== SVE_CRIT && issue.sev !== SVE_WARN) return;
      const canQuickFix = QUICKFIX_RULES.has(issue.rule) && QUICKFIX_FIELD_MAP[issue.field] && issue.rowIds && issue.rowIds.length;
      (canQuickFix ? quick : review).push(issue);
    });
    const info = issues.filter(i => i.rule === 'no_cita');
    return { quick, review, info };
  },

  /** Tarjeta de corrección rápida — input inline + Guardar. @private */
  _fixCardQuick(issue, variant) {
    const qf    = QUICKFIX_FIELD_MAP[issue.field];
    const sevCls = variant === 'info' ? 'info' : (issue.sev === SVE_WARN ? 'warn' : '');
    const dette  = issue.dette ? `<div class="fix-dette">Entrega ${escH(issue.dette)}</div>` : '';
    const rowIds = escH(JSON.stringify(issue.rowIds || []));
    return `
      <div class="fix-card ${sevCls}">
        <div class="fix-ruta">${escH(issue.ruta || '—')}${dette}</div>
        <div class="fix-field-info"><div class="fix-field-label">${escH(qf.label)}</div><div class="fix-field-desc">${escH(issue.desc)}</div></div>
        <div class="fix-input-wrap"><input class="fix-input" placeholder="${escH(qf.placeholder)}"></div>
        <button class="fix-save" data-fix-rowids="${rowIds}" data-fix-key="${escH(qf.key)}">✓ Guardar</button>
      </div>`;
  },

  /** Tarjeta "Revisar" — abre el drawer completo (o el selector de ruta si aplica a varias filas). Sin botón cuando la incidencia no tiene ruta asociada (ej. duplicados de catálogo) — se muestra la acción sugerida como texto. @private */
  _fixCardReview(issue) {
    const sevCls = issue.sev === SVE_WARN ? 'warn' : '';
    const dette  = issue.dette ? `<div class="fix-dette">Entrega ${escH(issue.dette)}</div>` : '';
    const rowIds = escH(JSON.stringify(issue.rowIds || []));
    const action = issue.ruta
      ? `<button class="fix-review-btn" data-locate-ruta="${escH(issue.ruta)}" data-locate-field="${escH(issue.field)}" data-locate-ids="${rowIds}">🔍 Revisar</button>`
      : `<div class="fix-hint">${escH(issue.action)}</div>`;
    return `
      <div class="fix-card ${sevCls} fix-card-review">
        <div class="fix-ruta">${escH(issue.ruta || '—')}${dette}</div>
        <div class="fix-field-info"><div class="fix-field-label">${escH(issue.field)}</div><div class="fix-field-desc">${escH(issue.desc)}</div></div>
        <div class="fix-input-wrap"></div>
        ${action}
      </div>`;
  },

  /** Pinta la pantalla completa de Correcciones — contador, barra de progreso, lista de tarjetas y la sección aparte de Cita. */
  renderFixList() {
    const list      = document.getElementById('fixList');
    const counter   = document.getElementById('fixCounter');
    const progress  = document.getElementById('fixProgress');
    const empty     = document.getElementById('fixEmpty');
    const emptyIco  = document.getElementById('fixEmptyIco');
    const emptyTtl  = document.getElementById('fixEmptyTitle');
    const emptySub  = document.getElementById('fixEmptySub');
    const infoWrap  = document.getElementById('fixInfoSection');
    const infoList  = document.getElementById('fixInfoList');
    if (!list || !counter || !progress) return;

    const { ok } = Events ? Events.checkSources() : { ok: true };

    if (!ok || !State.merged.length) {
      list.innerHTML = '';
      counter.textContent = '0';
      counter.classList.remove('done');
      progress.style.width = '0%';
      empty.classList.add('show');
      if (emptyIco) emptyIco.textContent = '📥';
      if (emptyTtl) emptyTtl.textContent = 'Aún no hay datos';
      if (emptySub) emptySub.textContent = 'Completa las 4 fuentes en Preparación para empezar a corregir.';
      if (infoWrap) infoWrap.style.display = 'none';
      return;
    }

    const { quick, review, info } = UI._buildFixBuckets();
    const total = quick.length + review.length;

    if (_fixPeakTotal === null || total > _fixPeakTotal) _fixPeakTotal = total;
    const pct = _fixPeakTotal > 0 ? Math.round((1 - total / _fixPeakTotal) * 100) : (total === 0 ? 100 : 0);

    counter.textContent = total;
    counter.classList.toggle('done', total === 0);
    progress.style.width = pct + '%';

    if (!total) {
      list.innerHTML = '';
      empty.classList.add('show');
      if (emptyIco) emptyIco.textContent = '🎉';
      if (emptyTtl) emptyTtl.textContent = 'Todo corregido';
      if (emptySub) emptySub.textContent = 'Ya no quedan incidencias pendientes — continúa al Dashboard de Calidad.';
    } else {
      empty.classList.remove('show');
      list.innerHTML = quick.map(i => UI._fixCardQuick(i)).join('') + review.map(i => UI._fixCardReview(i)).join('');
    }

    if (infoWrap) {
      infoWrap.style.display = info.length ? '' : 'none';
      if (infoList) infoList.innerHTML = info.map(i => UI._fixCardQuick(i, 'info')).join('');
    }
  },

  // ── SVE (panel de incidencias — vive en #legacyPanel por ahora) ──
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

  /** @private */
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
                      ${it.dette ? `<span class="sve-tag-dette">Entrega ${escH(it.dette)}</span>` : ''}
                      ${it.field ? `<span class="sve-tag-field">${escH(it.field)}</span>`     : ''}
                      ${it.extra ? `<span class="sve-tag-extra">${escH(it.extra)}</span>`     : ''}
                      ${it.ruta && (it.sev !== SVE_INFO || it.rule === 'no_cita' || it.rule === 'bad_march') ? `<button class="btn-locate" data-locate-ruta="${escH(it.ruta)}" data-locate-field="${escH(it.field)}" data-locate-ids="${escH(JSON.stringify(it.rowIds||[]))}">🔍 Localizar y corregir</button>` : ''}
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

  // ── Health rail — STUB (ver nota de cabecera). Se conserva el nombre
  // público porque events.js/edit-system.js/app.js lo siguen llamando;
  // su función visual (PulseBar en el topbar) queda reservada para el
  // Quality Ring de la futura pantalla "Calidad" del mockup.
  updateHealthRail() {
    // Intencionalmente sin efecto visual en esta fase.
  },

  applyMode() {
    document.body.dataset.mode = State.operationalMode;
  },

  // ── Catalog (operadores) ──
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

  // ── Catálogos Maestros (Camino C) ──
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
  // Warnings never disable export — they trigger a confirmation modal instead.
  // btnAddPDF/btnClear (barra de acciones antigua) se retiraron de este
  // método: la tarjeta de PDF sigue aceptando más archivos aunque ya
  // esté "done" (el input no se deshabilita), y "Reemplazar archivos"
  // (antes btnClear) vive ahora en la vista contraída de Preparación,
  // siempre habilitado.
  setActionsEnabled(on) {
    document.getElementById('btnExport').disabled  = !on || State.sveHasCritical;
    document.getElementById('btnExport2').disabled = !on || State.sveHasCritical;
  },

  // ── Dispatch History ──
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

  /**
   * HTML del <thead> de vista previa — usado EXCLUSIVAMENTE por
   * renderHistoryPreview() (modal de Historial). La Mesa de Trabajo
   * ya no lo usa — su thead es HTML estático (ver index.html).
   * @private
   */
  _previewTheadHtml() {
    return PREVIEW_COLS.map(c => {
      const cls = c==='RUTA' ? 'h-key' : COLS_PDF.has(c) ? 'h-pdf' : COLS_DESP.has(c) ? 'h-desp' : COLS_FILL.has(c) ? 'h-fill' : '';
      return `<th class="${cls}">${c.trim()}</th>`;
    }).join('');
  },

  /**
   * HTML del <tbody> de vista previa — usado EXCLUSIVAMENTE por
   * renderHistoryPreview(). Ver nota de _previewTheadHtml().
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

  renderHistoryPreview(rows, session) {
    document.getElementById('historyPreviewMeta').innerHTML =
      `${escH(session.session_date)} · Procesado por ${escH(session.created_by || '—')} · ` +
      `${rows.length} registros · calidad ${session.quality ?? '—'}%`;
    document.getElementById('histPreviewThead').innerHTML = UI._previewTheadHtml();
    UI._renderRowsBody(rows, 'histPreviewTbody');
  },

  // ── Reset everything ──
  resetAll() {
    State.pdfData  = new Map();
    State.xlsData  = null;
    State.factData = new Map();
    State.despData = new Map();
    State.wtmsData = new Map();   // FIX: faltaba en el reset original — bug latente desde que se agregó WTMS
    State.merged   = [];
    State.sveIssues = [];
    State.sveHasCritical = false;
    State.sveHasWarnings = false;
    State.sveLastQuality = 100;

    UI.setSourceStatus('pdf',  false, 'Arrastra o haz clic', 'Todos los archivos del día a la vez');
    UI.setSourceStatus('xls',  false, 'Arrastra o haz clic', 'Lee ambas pestañas automáticamente');
    UI.setSourceStatus('wtms', false, 'Arrastra o haz clic', 'Archivo .csv');
    UI.setSourceStatus('desp', false, 'Pega desde Excel',    'Copia RUTA · CASETA · WTMS · ID\'S MASTER');

    document.getElementById('pasteArea').value = '';
    document.getElementById('pasteSt').textContent = '';
    document.getElementById('pastePreview').classList.remove('on');

    _tableFilter = 'all';
    _tableSearch = '';
    const searchInput = document.getElementById('tableSearch');
    if (searchInput) searchInput.value = '';

    document.getElementById('svePanel').classList.remove('on');
    UI._resetSveCounters();
    document.getElementById('exportGate').classList.remove('on','forced');
    UI.clearErrors();
    UI.hideProgress();
    UI.setActionsEnabled(false);
    UI.resetFixPeak();
    UI.updatePrepView(['PDFs de cargas','Excel macro (RUTEO NUEVO)',"Status de despacho (RUTA + ID'S MASTER)",'Reporte WTMS']);
    UI.renderTable();
    UI.renderFixList();
    UI.updateStats();
    UI.updateHealthRail();
    UI.applyMode();
  }
};
