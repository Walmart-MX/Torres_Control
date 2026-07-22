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
 *   reglas L/M con los catálogos maestros (leen _enrichMisses, no
 *   los índices crudos).
 *
 * CAMBIO DE INTERFAZ respecto al código original (decisión de Fase 6
 * de la modularización, "Opción B" — inversión de control):
 *   runSVE(rows) NO toca UI. Devuelve:
 *     - null                                            si no hay rows
 *     - { issues, quality, nCrit, nWarn, nInfo, nPass }  si hay rows
 *   El caller (Events.triggerMerge) decide qué hacer con
 *   UI.resetSVE()/UI.renderSVE() según el resultado.
 *
 * CAMBIO (contexto de localización Ruta+Entrega — jul-2026):
 *   Varias reglas consolidaban incidencias por RUTA únicamente, lo cual
 *   ocultaba a qué ENTREGA (DETTE) específica pertenecía el problema
 *   cuando una ruta tenía múltiples líneas. Se agrega un campo `dette`
 *   al objeto de incidencia (issue), poblado según corresponda:
 *     - D1 (missing — Operador/Licencia): SIGUE consolidada solo por
 *       RUTA (sin dette) — son el mismo dato para todas las entregas de
 *       la ruta (decisión confirmada con EduarDo).
 *     - D2 (missing — Tarimas), A (dup_march), E (no_march) y J
 *       (bad_march): cambian su agrupación de `ruta` a `ruta+dette`,
 *       porque son datos que legítimamente varían por línea/entrega.
 *   Se agrega además una regla nueva independiente para CITA vacía
 *   (D-bis, rule id 'no_cita') — informativa, nunca bloquea exportación,
 *   ver su comentario específico más abajo. Reglas P/Q (WTMS) no se
 *   modifican — no tienen granularidad de entrega en su naturaleza.
 *
 * Nota de acoplamiento preexistente (regla K): esta función lee
 * document.getElementById('bdgXLS') directamente para comparar el
 * conteo mostrado en pantalla contra State.merged. Se preserva tal
 * cual del original.
 *
 * Dependencias:
 *   - State (core/state.js) — lee rows vía parámetro, escribe
 *     State.sveHasCritical / sveHasWarnings / sveLastQuality
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
  'no_wtms':'🚛','wtms_ambiguous':'⚠️','no_cita':'📅'
};

/**
 * Ejecuta las reglas de validación sobre las rows del merge.
 *
 * @param {Array<object>} rows — normalmente State.merged
 * @returns {null|{
 *   issues: Array<object>,
 *   quality: number,
 *   nCrit: number, nWarn: number, nInfo: number, nPass: number
 * }} — null si rows está vacío
 */
export function runSVE(rows) {
  if (!rows || !rows.length) return null;

  const raw = [];
  // rawAdd signature: (sev, rule, ruta, field, desc, action, extra, rowIds?, dette?)
  // dette: entrega (DETTE) a la que pertenece la incidencia — NUEVO (jul-2026),
  // para que el usuario identifique exactamente qué línea de la ruta debe
  // corregir sin buscar manualmente entre todas las entregas.
  const rawAdd = (sev, rule, ruta, field, desc, action, extra, rowIds, dette) =>
    raw.push({ sev, rule,
               ruta:   String(ruta||'').trim(),
               field:  String(field||'').trim(),
               desc:   String(desc||'').trim(),
               action: String(action||'').trim(),
               extra:  String(extra||'').trim(),
               rowIds: Array.isArray(rowIds) ? rowIds : [],
               dette:  String(dette||'').trim() });

  const matched = rows.filter(r => r._matched);

  const rowIdsByRuta = ruta =>
    rows.filter(r => String(r['RUTA']||'').trim() === ruta).map(r => r._rowId).filter(Boolean);

  // A: Marchamos duplicados entre rutas distintas
  // CAMBIO (contexto de localización Ruta+Entrega — jul-2026): se agrega
  // la entrega (DETTE) de ambos lados del conflicto en la descripción,
  // para que el usuario identifique exactamente qué línea de cada ruta
  // está en conflicto sin revisar todas las entregas.
  const marchMap = new Map();
  rows.forEach(r => {
    const ruta  = String(getMapped(r,'RUTA')||'').trim();
    const dette = String(getMapped(r,'DET')||'').trim();
    for (let m = 1; m <= 5; m++) {
      const marc = String(getMapped(r,`MARCHAMO ${m}`)||'').trim();
      if (!marc || marc === '0') continue;
      if (marchMap.has(marc)) {
        const prev = marchMap.get(marc);
        if (prev.ruta !== ruta) {
          rawAdd(SVE_CRIT,'dup_march', ruta, `MARCHAMO ${m}`,
            `Marchamo ${marc} asignado a ruta ${ruta} (entrega ${dette||'—'}) y también a ruta ${prev.ruta} (entrega ${prev.dette||'—'}).`,
            'Confirma con la documentación cuál ruta lleva este marchamo.',
            marc,
            [prev.rowId, r._rowId].filter(Boolean),
            dette);
        }
      } else {
        marchMap.set(marc, { ruta, rowId: r._rowId, dette });
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

  // D1: Operador y Licencia — atributos de la RUTA COMPLETA (mismo
  // operador/licencia para todas sus entregas), se consolidan SOLO por
  // RUTA — sin entrega — para que el usuario capture el dato una sola
  // vez en vez de repetirlo entrega tras entrega. Decisión confirmada
  // con EduarDo (jul-2026): a diferencia de TARIMAS (ver D2 abajo), estos
  // dos campos no varían por línea/destino dentro de la misma ruta.
  const missingRouteByRuta = new Map();
  const REQ_ROUTE = [
    { field:'OPERADOR', label:'Operador', sev:SVE_CRIT },
    { field:'LIC.',      label:'Licencia', sev:SVE_WARN },
  ];
  matched.forEach(r => {
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    if (!ruta) return;
    REQ_ROUTE.forEach(({ field, label, sev }) => {
      if (!String(getMapped(r, field)||'').trim()) {
        if (!missingRouteByRuta.has(ruta)) missingRouteByRuta.set(ruta, { fields: new Set(), sev: SVE_WARN, rowIds: new Set() });
        const e = missingRouteByRuta.get(ruta);
        e.fields.add(label);
        if (r._rowId) e.rowIds.add(r._rowId);
        if (sev === SVE_CRIT) e.sev = SVE_CRIT;
      }
    });
  });
  missingRouteByRuta.forEach(({ fields, sev, rowIds }, ruta) => {
    const fl  = [...fields].join(', ');
    const act = fields.has('Licencia') && fields.size === 1
      ? 'Agrega al operador en el catálogo.' : 'Revisa el PDF de esta ruta.';
    // Sin `dette` — la incidencia aplica a la ruta completa, no a una
    // entrega específica (ver justificación arriba).
    rawAdd(sev,'missing', ruta, fl,
      `Ruta ${ruta}: campo${fields.size>1?'s':''} incompleto${fields.size>1?'s':''} — ${fl}.`,
      act, '', [...rowIds]);
  });

  // D2: Tarimas — a diferencia de Operador/Licencia, SÍ varía por línea:
  // cada entrega/destino dentro de una ruta puede tener un conteo de
  // tarimas distinto. Se consolida por RUTA + ENTREGA (DETTE) para que
  // el usuario identifique exactamente cuál entrega tiene el dato
  // faltante sin tener que revisar todas las líneas de la ruta.
  const missingTarimasByRutaDette = new Map();
  matched.forEach(r => {
    const ruta  = String(getMapped(r,'RUTA')||'').trim();
    const dette = String(getMapped(r,'DET')||'').trim();
    if (!ruta) return;
    if (!String(getMapped(r,'TARIMAS')||'').trim()) {
      const groupKey = ruta + '||' + dette;
      if (!missingTarimasByRutaDette.has(groupKey)) missingTarimasByRutaDette.set(groupKey, { ruta, dette, rowIds: new Set() });
      const e = missingTarimasByRutaDette.get(groupKey);
      if (r._rowId) e.rowIds.add(r._rowId);
    }
  });
  missingTarimasByRutaDette.forEach(({ ruta, dette, rowIds }) => rawAdd(SVE_CRIT,'missing', ruta, 'Tarimas',
    `Ruta ${ruta} · Entrega ${dette||'—'}: campo incompleto — Tarimas.`,
    'Revisa el PDF de esta ruta.', '', [...rowIds], dette));

  // D-bis: CITA pendiente — regla NUEVA, independiente de D1/D2.
  // JUSTIFICACIÓN de por qué es una regla separada y no un campo más en
  // REQ_ROUTE/TARIMAS: esos campos son genuinamente obligatorios — su
  // ausencia es siempre un problema. CITA no lo es: no todas las entregas
  // tienen cita (puede deberse a que el dato no vino en el origen, o a
  // que la anotación del PDF no hizo match con ningún destino). Mezclarla
  // con los campos obligatorios escalaría su severidad junto a problemas
  // reales cuando aparecen en la misma entrega. Por eso es SIEMPRE
  // SVE_INFO — nunca bloquea la exportación — y se presenta como un dato
  // PENDIENTE de decisión del usuario, no como un error.
  const noCitaByRutaDette = new Map();
  matched.forEach(r => {
    const ruta  = String(getMapped(r,'RUTA')||'').trim();
    const dette = String(getMapped(r,'DET')||'').trim();
    if (!ruta) return;
    if (!String(getMapped(r,'CITA')||'').trim()) {
      const groupKey = ruta + '||' + dette;
      if (!noCitaByRutaDette.has(groupKey)) noCitaByRutaDette.set(groupKey, { ruta, dette, rowIds: new Set() });
      const e = noCitaByRutaDette.get(groupKey);
      if (r._rowId) e.rowIds.add(r._rowId);
    }
  });
  noCitaByRutaDette.forEach(({ ruta, dette, rowIds }) => rawAdd(SVE_INFO,'no_cita', ruta, 'CITA',
    `Ruta ${ruta} · Entrega ${dette||'—'}: sin cita capturada.`,
    'Verifica si esta entrega debe tener cita o déjala vacía si no aplica — no todas las entregas la requieren.',
    '', [...rowIds], dette));

  // E: Sin marchamo principal — consolidado por RUTA + ENTREGA (DETTE)
  const noMarchByRutaDette = new Map();
  matched.forEach(r => {
    const ruta  = String(getMapped(r,'RUTA')||'').trim();
    const dette = String(getMapped(r,'DET')||'').trim();
    const m1    = String(getMapped(r,'MARCHAMO 1')||'').trim();
    if (!m1 || m1 === '0') {
      const groupKey = ruta + '||' + dette;
      if (!noMarchByRutaDette.has(groupKey)) noMarchByRutaDette.set(groupKey, { ruta, dette, cnt: 0, rowIds: new Set() });
      const e = noMarchByRutaDette.get(groupKey);
      e.cnt++;
      if (r._rowId) e.rowIds.add(r._rowId);
    }
  });
  noMarchByRutaDette.forEach(({ ruta, dette, cnt, rowIds }) => rawAdd(SVE_WARN,'no_march', ruta,'MARCHAMO 1',
    `Ruta ${ruta} · Entrega ${dette||'—'}: sin marchamo principal${cnt>1?` (${cnt} líneas)`:''}.`,
    'Verifica que el PDF contenga número de marchamo.',
    cnt>1 ? `×${cnt} líneas`:'',
    [...rowIds], dette));

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

  // J: Marchamos con formato incorrecto — consolidado por RUTA + ENTREGA (DETTE)
  const badMarchByRutaDette = new Map();
  matched.forEach(r => {
    const ruta  = String(getMapped(r,'RUTA')||'').trim();
    const dette = String(getMapped(r,'DET')||'').trim();
    for (let m = 1; m <= 5; m++) {
      const marc = String(getMapped(r,`MARCHAMO ${m}`)||'').trim();
      if (!marc || marc==='0') continue;
      if (!/^\d{5,6}$/.test(marc.replace(/^0/,''))) {
        const groupKey = ruta + '||' + dette;
        if (!badMarchByRutaDette.has(groupKey)) badMarchByRutaDette.set(groupKey, { ruta, dette, vals: new Set(), rowIds: new Set() });
        const e = badMarchByRutaDette.get(groupKey);
        e.vals.add(marc);
        if (r._rowId) e.rowIds.add(r._rowId);
      }
    }
  });
  badMarchByRutaDette.forEach(({ ruta, dette, vals, rowIds }) => {
    const sample = [...vals].slice(0,3).join(', ') + (vals.size>3?'…':'');
    rawAdd(SVE_INFO,'bad_march', ruta,'MARCHAMOS',
      `Ruta ${ruta} · Entrega ${dette||'—'}: ${vals.size} marchamo${vals.size>1?'s':''} con formato inesperado (${sample}).`,
      'Los marchamos deben ser numéricos de 5-6 dígitos.',
      vals.size>1?`×${vals.size}`:'',
      [...rowIds], dette);
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
  // Key: rule + ruta + field + dette — se agrega `dette` (jul-2026) para
  // que dos incidencias del mismo tipo/ruta/campo pertenecientes a
  // distintas entregas NO se colapsen en una sola. Para las reglas que
  // no setean `dette` (P/Q/etc.), el valor por defecto es '' — su
  // comportamiento de dedup no cambia.
  const seen = new Set();
  const issues = [];
  for (const issue of raw) {
    const key = `${issue.rule}||${issue.ruta}||${issue.field}||${issue.dette}`;
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
