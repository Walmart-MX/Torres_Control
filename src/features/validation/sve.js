/**
 * features/validation/sve.js
 * SMART VALIDATION ENGINE v1.2 — audita State.merged tras cada merge
 * y produce un reporte de incidencias (críticas, advertencias, informativas)
 * más un score de calidad 0-100.
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   Dos reglas nuevas, P y Q:
 *     P — 'no_wtms' (ADVERTENCIA): el ID'S MASTER de una ruta no
 *         encontró coincidencia en el Reporte WTMS. No bloquea
 *         exportación — el usuario ya ve 'N/A' en ID RETORNO y puede
 *         decidir si eso es aceptable o requiere corrección manual.
 *     Q — 'wtms_ambiguous' (CRÍTICA): el WTMS devolvió un valor doble
 *         separado por coma (ej. "1234,4321") para ID RETORNO o
 *         CARTA PORTE — bloquea exportación hasta que el usuario elija
 *         manualmente cuál valor es correcto (ver EDITABLE_FIELDS en
 *         editing/edit-system.js, campos '_ID_RETORNO'/'_CARTA_PORTE').
 *   Ambas se alimentan de flags que arma processors/merge.js
 *   (_wtmsMatched / _wtmsAmbiguous) — sve.js no vuelve a tocar
 *   State.wtmsData directamente, mismo principio que ya seguían las
 *   reglas L/M con los catálogos maestros.
 *
 * CAMBIO DE INTERFAZ respecto al código original (Fase 6, "Opción B"):
 *   runSVE(rows) NO toca UI. Devuelve:
 *     - null                                            si no hay rows
 *     - { issues, quality, nCrit, nWarn, nInfo, nPass }  si hay rows
 *   El caller (Events.triggerMerge) decide qué hacer con
 *   UI.resetSVE()/UI.renderSVE() según el resultado.
 *
 * Nota de acoplamiento preexistente (regla K): lee
 * document.getElementById('bdgXLS') directamente. Se preserva del original.
 *
 * Dependencias:
 *   - State (core/state.js)
 *   - getMapped (core/constants.js)
 */
import { State } from '../../core/state.js';
import { getMapped } from '../../core/constants.js';

export const SVE_CRIT = 'CRÍTICA';
export const SVE_WARN = 'ADVERTENCIA';
export const SVE_INFO = 'INFORMATIVA';

export const SVE_ICONS = {
  'dup_march':'🔖','dup_tarimas':'📦','missing_ruta':'🔴','missing':'🟠',
  'no_march':'🔴','zero_tar':'📐','high_tar':'📐','no_pdf':'🟡',
  'no_fac':'ℹ️','bad_march':'ℹ️','integrity':'🔗','no_ventana':'📇','no_pool':'🚚','cat_dup':'🗂️','time_anomaly':'⏱️',
  'no_wtms':'🚛','wtms_ambiguous':'⚠️'
};

/**
 * Ejecuta las reglas de validación sobre las rows del merge.
 * @param {Array<object>} rows — normalmente State.merged
 * @returns {null|{ issues, quality, nCrit, nWarn, nInfo, nPass }}
 */
export function runSVE(rows) {
  if (!rows || !rows.length) return null;

  const raw = [];
  const rawAdd = (sev, rule, ruta, field, desc, action, extra, rowIds) =>
    raw.push({ sev, rule,
               ruta:   String(ruta||'').trim(),
               field:  String(field||'').trim(),
               desc:   String(desc||'').trim(),
               action: String(action||'').trim(),
               extra:  String(extra||'').trim(),
               rowIds: Array.isArray(rowIds) ? rowIds : [] });

  const matched = rows.filter(r => r._matched);

  const rowIdsByRuta = ruta =>
    rows.filter(r => String(r['RUTA']||'').trim() === ruta).map(r => r._rowId).filter(Boolean);

  // A: Marchamos duplicados entre rutas distintas
  const marchMap = new Map();
  rows.forEach(r => {
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    for (let m = 1; m <= 5; m++) {
      const marc = String(getMapped(r,`MARCHAMO ${m}`)||'').trim();
      if (!marc || marc === '0') continue;
      if (marchMap.has(marc)) {
        const prev = marchMap.get(marc);
        if (prev.ruta !== ruta) {
          rawAdd(SVE_CRIT,'dup_march', ruta, `MARCHAMO ${m}`,
            `Marchamo ${marc} asignado a ruta ${ruta} y también a ruta ${prev.ruta}.`,
            'Confirma con la documentación cuál ruta lleva este marchamo.',
            marc,
            [prev.rowId, r._rowId].filter(Boolean));
        }
      } else {
        marchMap.set(marc, { ruta, rowId: r._rowId });
      }
    }
  });

  // B: Tarimas idénticas en múltiples líneas de la misma ruta
  const lineCount = new Map(), tarMap = new Map();
  rows.forEach(r => {
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    const tar  = String(getMapped(r,'TARIMAS')||'').trim();
    if (!ruta) return;
    lineCount.set(ruta, (lineCount.get(ruta)||0) + 1);
    if (tar && tar !== '0') {
      if (!tarMap.has(ruta)) tarMap.set(ruta, new Set());
      tarMap.get(ruta).add(tar);
    }
  });
  lineCount.forEach((cnt, ruta) => {
    if (cnt < 2) return;
    const vals = tarMap.get(ruta);
    if (vals && vals.size === 1) rawAdd(SVE_WARN,'dup_tarimas', ruta, 'TARIMAS',
      `Ruta ${ruta}: las ${cnt} líneas comparten el mismo conteo de tarimas (${[...vals][0]}) — posible asignación duplicada de PDF.`,
      'Verifica si el PDF se asignó a múltiples líneas por error.',
      `${[...vals][0]} tar. × ${cnt} líneas`,
      rowIdsByRuta(ruta));
  });

  // C: Registros sin RUTA
  let noRutaCnt = 0;
  rows.forEach(r => { if (!String(getMapped(r,'RUTA')||'').trim()) noRutaCnt++; });
  if (noRutaCnt) rawAdd(SVE_CRIT,'missing_ruta','','RUTA',
    `${noRutaCnt} registro${noRutaCnt>1?'s':''} sin número de RUTA.`,
    'Revisa el Excel macro: busca filas con columna RUTA vacía.',
    noRutaCnt > 1 ? `×${noRutaCnt}` : '');

  // D: Campos obligatorios vacíos — consolidado por ruta
  const missingByRuta = new Map();
  const REQ = [
    { field:'OPERADOR', label:'Operador', sev:SVE_CRIT },
    { field:'TARIMAS',  label:'Tarimas',  sev:SVE_CRIT },
    { field:'LIC.',     label:'Licencia', sev:SVE_WARN },
  ];
  matched.forEach(r => {
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    if (!ruta) return;
    REQ.forEach(({ field, label, sev }) => {
      if (!String(getMapped(r, field)||'').trim()) {
        if (!missingByRuta.has(ruta)) missingByRuta.set(ruta, { fields: new Set(), sev: SVE_WARN, rowIds: new Set() });
        const e = missingByRuta.get(ruta);
        e.fields.add(label);
        if (r._rowId) e.rowIds.add(r._rowId);
        if (sev === SVE_CRIT) e.sev = SVE_CRIT;
      }
    });
  });
  missingByRuta.forEach(({ fields, sev, rowIds }, ruta) => {
    const fl  = [...fields].join(', ');
    const act = fields.has('Licencia') && fields.size === 1
      ? 'Agrega al operador en el catálogo.' : 'Revisa el PDF de esta ruta.';
    rawAdd(sev,'missing', ruta, fl,
      `Ruta ${ruta}: campo${fields.size>1?'s':''} incompleto${fields.size>1?'s':''} — ${fl}.`,
      act, '', [...rowIds]);
  });

  // E: Sin marchamo principal — consolidado por ruta
  const noMarchByRuta = new Map();
  matched.forEach(r => {
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    const m1   = String(getMapped(r,'MARCHAMO 1')||'').trim();
    if (!m1 || m1 === '0') {
      if (!noMarchByRuta.has(ruta)) noMarchByRuta.set(ruta, { cnt: 0, rowIds: new Set() });
      const e = noMarchByRuta.get(ruta);
      e.cnt++;
      if (r._rowId) e.rowIds.add(r._rowId);
    }
  });
  noMarchByRuta.forEach(({ cnt, rowIds }, ruta) => {
    const tot = lineCount.get(ruta) || 1;
    rawAdd(SVE_WARN,'no_march', ruta,'MARCHAMO 1',
      `Ruta ${ruta}: sin marchamo principal${cnt>1?` (${cnt}/${tot} líneas)`:''}. `,
      'Verifica que el PDF contenga número de marchamo.',
      cnt>1 ? `×${cnt} líneas`:'',
      [...rowIds]);
  });

  // F: Tarimas = 0 — consolidado por ruta
  const zeroTarByRuta = new Map();
  matched.forEach(r => {
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    const tar  = parseInt(String(getMapped(r,'TARIMAS')||'0').replace(/\D/g,''), 10);
    if (isNaN(tar) || tar === 0) {
      if (!zeroTarByRuta.has(ruta)) zeroTarByRuta.set(ruta, { cnt: 0, rowIds: new Set() });
      const e = zeroTarByRuta.get(ruta);
      e.cnt++;
      if (r._rowId) e.rowIds.add(r._rowId);
    }
  });
  zeroTarByRuta.forEach(({ cnt, rowIds }, ruta) => rawAdd(SVE_WARN,'zero_tar', ruta,'TARIMAS',
    `Ruta ${ruta}: tarimas = 0 o no detectadas.`,
    'Confirma que el PDF esté correctamente asignado a esta ruta.',
    cnt>1?`×${cnt} líneas`:'',
    [...rowIds]));

  // G: Tarimas > 60 — consolidado por ruta
  const highTarByRuta = new Map();
  matched.forEach(r => {
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    const tar  = parseInt(String(getMapped(r,'TARIMAS')||'0').replace(/\D/g,''), 10);
    if (tar > 60) {
      const prev = highTarByRuta.get(ruta) || { tar: 0, rowIds: new Set() };
      if (tar > prev.tar) prev.tar = tar;
      if (r._rowId) prev.rowIds.add(r._rowId);
      highTarByRuta.set(ruta, prev);
    }
  });
  highTarByRuta.forEach(({ tar, rowIds }, ruta) => rawAdd(SVE_WARN,'high_tar', ruta,'TARIMAS',
    `Ruta ${ruta}: tarimas inusualmente altas (${tar}).`,
    'Confirma si es una carga doble o error de lectura de PDF.',
    `${tar} tar.`,
    [...rowIds]));

  // H: Rutas sin PDF — una alerta por ruta
  const noPdfByRuta = new Map();
  rows.forEach(r => {
    if (r._matched) return;
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    if (!ruta) return;
    if (!noPdfByRuta.has(ruta)) noPdfByRuta.set(ruta, { cnt: 0, rowIds: new Set() });
    const e = noPdfByRuta.get(ruta);
    e.cnt++;
    if (r._rowId) e.rowIds.add(r._rowId);
  });
  noPdfByRuta.forEach(({ cnt, rowIds }, ruta) => rawAdd(SVE_WARN,'no_pdf', ruta,'OPERADOR / LIC. / MARCHAMOS',
    `Ruta ${ruta} sin PDF asociado${cnt>1?` (${cnt} entregas)`:''}.`,
    'Carga el PDF de esta ruta o verifica el nombre del archivo.',
    cnt>1?`${cnt} entregas`:'',
    [...rowIds]));

  // I: Sin factura — consolidado por ruta
  const noFacByRuta = new Map();
  matched.forEach(r => {
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    if (!String(getMapped(r,'FAC.')||'').trim()) {
      if (!noFacByRuta.has(ruta)) noFacByRuta.set(ruta, { cnt: 0, rowIds: new Set() });
      const e = noFacByRuta.get(ruta);
      e.cnt++;
      if (r._rowId) e.rowIds.add(r._rowId);
    }
  });
  noFacByRuta.forEach(({ cnt, rowIds }, ruta) => rawAdd(SVE_INFO,'no_fac', ruta,'FAC.',
    `Ruta ${ruta}: sin factura extraída del PDF${cnt>1?` (${cnt} líneas)`:''}. `,
    'El PDF puede no contener facturas 4659xxxxxx o el patrón no coincidió.',
    cnt>1?`×${cnt}`:'',
    [...rowIds]));

  // J: Marchamos con formato incorrecto — consolidado por ruta
  const badMarchByRuta = new Map();
  matched.forEach(r => {
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    for (let m = 1; m <= 5; m++) {
      const marc = String(getMapped(r,`MARCHAMO ${m}`)||'').trim();
      if (!marc || marc==='0') continue;
      if (!/^\d{5,6}$/.test(marc.replace(/^0/,''))) {
        if (!badMarchByRuta.has(ruta)) badMarchByRuta.set(ruta, { vals: new Set(), rowIds: new Set() });
        const e = badMarchByRuta.get(ruta);
        e.vals.add(marc);
        if (r._rowId) e.rowIds.add(r._rowId);
      }
    }
  });
  badMarchByRuta.forEach(({ vals, rowIds }, ruta) => {
    const sample = [...vals].slice(0,3).join(', ') + (vals.size>3?'…':'');
    rawAdd(SVE_INFO,'bad_march', ruta,'MARCHAMOS',
      `Ruta ${ruta}: ${vals.size} marchamo${vals.size>1?'s':''} con formato inesperado (${sample}).`,
      'Los marchamos deben ser numéricos de 5-6 dígitos.',
      vals.size>1?`×${vals.size}`:'',
      [...rowIds]);
  });

  // L: Ventana de Recibo — DETTE no encontrado (consolidado por ruta)
  const noVentanaByRuta = new Map();
  matched.forEach(r => {
    const miss = (r._enrichMisses || []).find(m => m.catalog === 'ventanaRecibo');
    if (!miss) return;
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    if (!noVentanaByRuta.has(ruta)) noVentanaByRuta.set(ruta, { cnt: 0, rowIds: new Set() });
    const e = noVentanaByRuta.get(ruta);
    e.cnt++;
    if (r._rowId) e.rowIds.add(r._rowId);
  });
  noVentanaByRuta.forEach(({ cnt, rowIds }, ruta) => rawAdd(SVE_WARN,'no_ventana', ruta,'FORMATO / TIENDA / ESTADO',
    `Ruta ${ruta}: DETTE no encontrado en el catálogo Ventana de Recibo.`,
    'Verifica el DETTE en RUTEO NUEVO o actualiza el catálogo.',
    cnt>1?`×${cnt}`:'',
    [...rowIds]));

  // M: Pool Real — ECO/REMOLQUE no encontrado (consolidado por ruta)
  const noPoolByRuta = new Map();
  matched.forEach(r => {
    const misses = (r._enrichMisses || []).filter(m => m.catalog === 'poolReal');
    if (!misses.length) return;
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    if (!noPoolByRuta.has(ruta)) noPoolByRuta.set(ruta, { fields: new Set(), rowIds: new Set() });
    const e = noPoolByRuta.get(ruta);
    misses.forEach(m => e.fields.add(m.index));
    if (r._rowId) e.rowIds.add(r._rowId);
  });
  noPoolByRuta.forEach(({ fields, rowIds }, ruta) => {
    const fl = [...fields].join(', ');
    rawAdd(SVE_WARN,'no_pool', ruta, fl,
      `Ruta ${ruta}: ${fl} no encontrado en el catálogo Pool Real.`,
      'Verifica TRACTOR/REMOLQUE (UNIDAD) en RUTEO NUEVO o actualiza el catálogo.',
      '', [...rowIds]);
  });

  // N: Catálogos — llaves duplicadas dentro del propio catálogo (una vez por corrida)
  (State.catalogDuplicates || []).forEach(d => {
    rawAdd(SVE_WARN,'cat_dup','', d.index,
      `Catálogo ${d.catalog === 'ventanaRecibo' ? 'Ventana de Recibo' : 'Pool Real'}: valor duplicado "${d.value}" en ${d.index}.`,
      'Revisa el catálogo — puede causar cruces incorrectos.',
      d.value);
  });

  // O: Anomalías del motor de tiempos — orden invertido / duración anormal
  const timeIssuesByRuta = new Map();
  matched.forEach(r => {
    const anomalies = r._timeAnomalies || [];
    if (!anomalies.length) return;
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    if (!timeIssuesByRuta.has(ruta)) timeIssuesByRuta.set(ruta, { invertido: 0, anormal: 0, rowIds: new Set() });
    const e = timeIssuesByRuta.get(ruta);
    anomalies.forEach(a => { if (a.reason === 'orden_invertido') e.invertido++; else e.anormal++; });
    if (r._rowId) e.rowIds.add(r._rowId);
  });
  timeIssuesByRuta.forEach(({ invertido, anormal, rowIds }, ruta) => {
    const parts = [];
    if (invertido) parts.push(`${invertido} con orden invertido`);
    if (anormal)   parts.push(`${anormal} con duración anormal`);
    rawAdd(SVE_INFO,'time_anomaly', ruta, 'TIEMPOS',
      `Ruta ${ruta}: ${parts.join(' · ')} en los cálculos de tiempo.`,
      'Revisa las fechas capturadas de enrampe/retiro/despacho/caseta.',
      '', [...rowIds]);
  });

  // P: WTMS — ID'S MASTER no encontrado (consolidado por ruta) — NUEVO
  const noWtmsByRuta = new Map();
  matched.forEach(r => {
    if (r._wtmsMatched === false) {
      const ruta = String(getMapped(r,'RUTA')||'').trim();
      if (!noWtmsByRuta.has(ruta)) noWtmsByRuta.set(ruta, { cnt: 0, rowIds: new Set() });
      const e = noWtmsByRuta.get(ruta);
      e.cnt++;
      if (r._rowId) e.rowIds.add(r._rowId);
    }
  });
  noWtmsByRuta.forEach(({ cnt, rowIds }, ruta) => rawAdd(SVE_WARN,'no_wtms', ruta, 'ID RETORNO',
    `Ruta ${ruta}: ID'S MASTER no encontrado en el Reporte WTMS — ID RETORNO marcado como N/A.`,
    "Verifica el ID'S MASTER en Status de despacho o confirma en el WTMS.",
    cnt>1?`×${cnt}`:'',
    [...rowIds]));

  // Q: WTMS — valor doble ambiguo en ID RETORNO/CARTA PORTE — NUEVO
  const ambigByRuta = new Map();
  matched.forEach(r => {
    if (r._wtmsAmbiguous) {
      const ruta = String(getMapped(r,'RUTA')||'').trim();
      if (!ambigByRuta.has(ruta)) ambigByRuta.set(ruta, { cnt: 0, rowIds: new Set() });
      const e = ambigByRuta.get(ruta);
      e.cnt++;
      if (r._rowId) e.rowIds.add(r._rowId);
    }
  });
  ambigByRuta.forEach(({ cnt, rowIds }, ruta) => rawAdd(SVE_CRIT,'wtms_ambiguous', ruta, 'ID RETORNO',
    `Ruta ${ruta}: el WTMS devolvió múltiples valores para ID RETORNO/CARTA PORTE — requiere selección manual.`,
    'Abre el registro y elige cuál de los dos valores es el correcto.',
    cnt>1?`×${cnt}`:'',
    [...rowIds]));

  // K: Integridad UI vs memoria
  const screenCnt = parseInt(document.getElementById('bdgXLS').textContent || '0', 10);
  if (screenCnt && screenCnt !== rows.length)
    rawAdd(SVE_CRIT,'integrity','','CONTEO',
      `Discrepancia: UI muestra ${screenCnt} rutas, memoria contiene ${rows.length}.`,
      'Recarga la página y vuelve a procesar los archivos.',
      `UI:${screenCnt}/MEM:${rows.length}`);

  // ── DEDUP ENGINE ──
  const seen = new Set();
  const issues = [];
  for (const issue of raw) {
    const key = `${issue.rule}||${issue.ruta}||${issue.field}`;
    if (!seen.has(key)) { seen.add(key); issues.push(issue); }
  }

  // ── QUALITY SCORE ──
  const W = { CRÍTICA: 5, ADVERTENCIA: 2, INFORMATIVA: 0.5 };
  let deductions = 0;
  issues.forEach(i => { deductions += W[i.sev] || 1; });
  const quality  = Math.max(0, Math.round(100 - Math.min(100, deductions)));
  const nCrit    = issues.filter(i => i.sev === SVE_CRIT).length;
  const nWarn    = issues.filter(i => i.sev === SVE_WARN).length;
  const nInfo    = issues.filter(i => i.sev === SVE_INFO).length;
  const nPass    = Math.max(0, 10 - new Set(issues.map(i => i.rule)).size);

  State.sveHasCritical = nCrit > 0;
  State.sveHasWarnings = nWarn > 0;
  State.sveLastQuality = quality;

  return { issues, quality, nCrit, nWarn, nInfo, nPass };
}
