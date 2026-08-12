/**
 * features/validation/sve.js
 * SMART VALIDATION ENGINE v1.4 — audita State.merged tras cada merge
 * y produce un reporte de incidencias (críticas, advertencias, informativas)
 * más un score de calidad 0-100.
 *
 * CAMBIO DE INTERFAZ respecto al código original (decisión de Fase 6
 * de la modularización, "Opción B" — inversión de control):
 *   Antes: runSVE(rows) llamaba a UI.resetSVE() / UI.renderSVE(...) directamente.
 *   Ahora: runSVE(rows) NO toca UI. Devuelve:
 *     - null                                            si no hay rows
 *     - { issues, quality, nCrit, nWarn, nInfo, nPass }  si hay rows
 *   El caller (Events.triggerMerge, EditSystem.saveAndRevalidate) es
 *   responsable de decidir qué hacer con UI.resetSVE() / UI.renderSVE()
 *   según el resultado.
 *
 * CAMBIO (contexto de localización Ruta+Entrega — jul-2026):
 *   Varias reglas consolidaban incidencias por RUTA únicamente, lo cual
 *   ocultaba a qué ENTREGA (DETTE) específica pertenecía el problema
 *   cuando una ruta tenía múltiples líneas. Se agrega un campo `dette`
 *   al objeto de incidencia (issue), poblado según corresponda por cada
 *   regla — ver detalle en versiones anteriores de este comentario.
 *
 * CAMBIO (rediseño Correcciones — mockup jul-2026):
 *   - D1 (Operador/Licencia) se separa en DOS issues independientes en
 *     vez de un field combinado "Operador, Licencia" — cada issue debe
 *     mapear a UN solo campo editable para la tarjeta de corrección
 *     rápida de Correcciones (ver ui.js → QUICKFIX_FIELD_MAP).
 *   - F (zero_tar) y G (high_tar) pasan de agrupar por RUTA a agrupar
 *     por RUTA + ENTREGA (DETTE) — consistente con D2 (tarimas
 *     faltantes), confirmado con EduarDo: las tres reglas de tarimas
 *     deben identificar la entrega exacta, no solo la ruta.
 *   - D2 cambia su field de 'Tarimas' a 'TARIMAS' (mayúsculas) — mismo
 *     texto que F/G, para que las tres mapeen al mismo campo editable.
 *
 * CAMBIO (rediseño Mesa de Trabajo — mockup jul-2026, "Fix regla K"):
 *   runSVE(rows) ganaba una SEGUNDA fuente de verdad no declarada: leía
 *   document.getElementById('bdgXLS').textContent directamente del DOM
 *   para la regla K (integridad UI vs memoria). sve.js vuelve a ser una
 *   función pura, sin ninguna lectura de document.*. runSVE(rows,
 *   screenCount) recibe el conteo como PARÁMETRO — ver detalle abajo en
 *   la regla K.
 *
 * CAMBIO (jul-2026 — integridad de datos, "bug del marchamo heredado"):
 *   Se detectó que un marchamo con formato inválido en el PDF podía
 *   provocar que la entrega heredara marchamo Y factura de OTRA entrega
 *   de la misma ruta (ver processors/merge.js y processors/pdf.js para
 *   el detalle completo del root cause y su corrección). Dos ajustes
 *   aquí, ambos de solo-lectura sobre datos ya calculados aguas arriba:
 *
 *   1) Regla J (bad_march) — REESCRITA. Antes escaneaba los valores
 *      YA GUARDADOS en MARCHAMO 1-5 buscando formato inválido. Ahora
 *      pdf.js valida cada marchamo en el momento de extraerlo (ver
 *      processors/pdf.js, extracción tolerante por campo) y jamás dejó
 *      pasar un valor inválido a MARCHAMO N — esa posición ya llegó
 *      vacía. La fuente de esta regla pasa a ser r._marchamoIssues
 *      (poblado en merge.js desde pdfRow.marchamoIssues): el valor
 *      CRUDO que se intentó leer del PDF y no pasó el formato, para que
 *      el usuario pueda verificarlo contra el documento original. Sigue
 *      siendo SVE_INFO — la incidencia ACCIONABLE (el campo vacío) la
 *      cubre automáticamente la regla E (no_march), que ya es quickfix.
 *
 *   2) Regla nueva 'pdf_ambiguous' (CRÍTICA) — cubre el caso distinto de
 *      "no se pudo localizar NINGÚN bloque de PDF con certeza para esta
 *      entrega" (más de un bloque candidato en la misma ruta, sin match
 *      específico por factura/DETTE, Y el DETTE de esta fila sí aparece
 *      entre los destinos de esos bloques). A diferencia de bad_march,
 *      aquí no hay un campo puntual que validar — es la entrega COMPLETA
 *      la que quedó sin datos de PDF, por diseño (merge.js nunca adivina
 *      entre candidatos ambiguos). Se excluye de la regla H (no_pdf)
 *      para no duplicar el aviso con un mensaje menos preciso.
 *
 * CAMBIO (jul-2026 — revisión de reglas operativas, decisión de EduarDo):
 *   1) Regla B (dup_tarimas) — ELIMINADA POR COMPLETO. EduarDo confirmó
 *      que dos entregas de la misma ruta compartiendo el mismo conteo
 *      de tarimas es un patrón NORMAL del día a día (no indica PDF mal
 *      asignado como se asumía originalmente) — la regla generaba
 *      ruido sin valor operativo real. Se retira la generación de la
 *      incidencia y el cómputo que solo alimentaba a esta regla
 *      (lineCount/tarMap y el helper rowIdsByRuta, que no tenía otro
 *      consumidor). El ícono 'dup_tarimas' se retira de SVE_ICONS por
 *      la misma razón — evitar código muerto.
 *
 *   2) Reglas L (no_ventana) y M (no_pool) — bajan de SVE_WARN a
 *      SVE_INFO. Motivo: FORMATO/TIENDA/ESTADO/NOMBRE (Ventana de
 *      Recibo) y LINEA/PLACA TRACTOR/ESQUEMA/PLACA REMOLQUE/CAP. (Pool
 *      Real) NO son campos que el operador de captura pueda corregir
 *      desde la Mesa de Trabajo o Correcciones — de hecho no existe
 *      entrada para ellos en EDITABLE_FIELDS (editing/edit-system.js),
 *      así que el botón "🔍 Revisar" que antes generaban llevaba a un
 *      drawer sin ningún campo editable relacionado: un callejón sin
 *      salida para el operador. La única corrección real es actualizar
 *      el catálogo maestro correspondiente en Administración (acceso
 *      reservado a quien administra Supabase). Como SVE_INFO: ya no
 *      cuentan en el contador de "incidencias pendientes" de
 *      Correcciones, ya no activan el modal de advertencias al
 *      exportar, y solo restan 0.5 puntos de calidad (antes 2) — visible
 *      igualmente en el panel de auditoría interno para quien necesite
 *      diagnosticar cobertura de catálogos.
 *
 *   NOTA para EduarDo: la regla N (cat_dup, duplicados dentro del propio
 *   catálogo) NO se tocó en este cambio — sigue siendo SVE_WARN. Se
 *   comporta distinto a lo que tu mensaje sugería: aunque en las
 *   tarjetas de Correcciones se muestra solo como texto informativo
 *   (sin botón, porque no tiene RUTA asociada), SÍ sigue sumando al
 *   contador de "incidencias pendientes" y al modal de advertencias
 *   al exportar. Si quieres el mismo tratamiento informativo puro para
 *   cat_dup, es un cambio de una línea (SVE_WARN → SVE_INFO) — avísame
 *   y lo aplico igual que aquí.
 *
 * CAMBIO (jul-2026 — nueva regla 'dette_sin_pdf', caso "se quedó por
 * ocupación"):
 *   Antes, cuando una entrega del Excel (RUTEO NUEVO) no tenía NINGÚN
 *   bloque de PDF correspondiente y la ruta tenía más de un bloque
 *   candidato, el motor reportaba SIEMPRE 'pdf_ambiguous' (CRÍTICA) —
 *   aunque el DETTE de esa fila no apareciera en ningún bloque del PDF
 *   en absoluto. Caso real confirmado con EduarDo: una entrega se queda
 *   por ocupación (ya no se va a despachar) y por lo tanto el PDF —
 *   generado por la misma plataforma WTMS — nunca trae su bloque. Eso
 *   NO es ambigüedad (no hay nada que "adivinar entre varios
 *   candidatos"), así que se separó en dos reglas (ver
 *   processors/merge.js para el detalle de la detección):
 *     - 'pdf_ambiguous' se conserva sin cambios para el caso real de
 *       ambigüedad (el DETTE SÍ aparece en el PDF, pero en más de un
 *       bloque sin match específico).
 *     - 'dette_sin_pdf' (NUEVA, ADVERTENCIA) cubre el caso "el DETTE no
 *       aparece en ningún bloque" — mensaje orientado a que el usuario
 *       confirme si la entrega debe excluirse del día operativo (ver
 *       ui.js → CONFIRM_RULES / _fixCardConfirm() y
 *       events.js → confirmExcludedDette()).
 *
 * CAMBIO (jul-2026 — regla K, mensaje de discrepancia y descuento de
 * exclusiones confirmadas):
 *   1) "rutas" → "entregas": el conteo real que compara esta regla es
 *      de FILAS de RUTEO NUEVO (State.xlsData.length, una fila = una
 *      entrega) contra State.merged.length — nunca fue un conteo de
 *      rutas (una ruta puede tener varias entregas). El mensaje ahora
 *      refleja lo que realmente se está comparando.
 *   2) Se agrega el parámetro `excludedCount` (ver core/state.js →
 *      State.excludedCount, calculado en processors/merge.js): cuando
 *      el usuario confirma que una entrega sin PDF "no se realizará"
 *      (ver events.js → confirmExcludedDette()), esa entrega se filtra
 *      deliberadamente ANTES de llegar a State.merged — antes, la
 *      regla K no lo sabía y generaba una alerta CRÍTICA falsa
 *      ("discrepancia") justo en el caso que EduarDo describe como
 *      normal y esperado (DETTE cancelada y confirmada). Ahora se
 *      descuenta excludedCount de screenCount antes de comparar: si la
 *      diferencia se explica POR COMPLETO por exclusiones confirmadas,
 *      no se genera ninguna incidencia. Si sigue habiendo una
 *      diferencia no explicada, la alerta crítica se conserva sin
 *      cambios — sigue siendo la señal correcta de un problema real
 *      (ej. recarga de página a medio proceso).
 *
 * CAMBIO (ago-2026 — refuerzo de detección de marchamos duplicados
 * DENTRO de la misma ruta, confirmado con EduarDo):
 *   Antes, la regla A (dup_march) SOLO reportaba un marchamo repetido
 *   cuando aparecía en DOS RUTAS DISTINTAS (`prev.ruta !== ruta`). Si
 *   el mismo marchamo se repetía dentro de la MISMA ruta, el código no
 *   generaba ninguna incidencia — un hueco real, porque un marchamo es
 *   único e irrepetible por entrega SIN IMPORTAR si coincide la ruta o
 *   no. Se agregan dos casos nuevos, ambos derivados del mismo
 *   `marchMap` ya existente (sin costo adicional de recorrido):
 *
 *   1) 'dup_march_ruta' (SVE_CRIT) — el marchamo se repite en DOS
 *      ENTREGAS DISTINTAS de la MISMA ruta (mismo problema de fondo que
 *      dup_march: un sello físico no puede estar en dos cargas — solo
 *      cambia si la ruta coincide o no). Bloquea la exportación igual
 *      que dup_march, hasta que se verifique cuál entrega lleva
 *      realmente ese marchamo.
 *
 *   2) 'dup_march_self' (SVE_WARN) — el marchamo se repite DOS VECES
 *      dentro de la MISMA entrega (dos posiciones MARCHAMO N distintas
 *      del mismo registro). Normalmente es un error de captura (mismo
 *      valor pegado dos veces) — no bloquea la exportación, pero se
 *      muestra en Correcciones para que se verifique contra el PDF.
 *
 *   Ambas reutilizan la tarjeta "🔍 Revisar" genérica de Correcciones
 *   (no están en QUICKFIX_RULES/MULTI_RULES/CONFIRM_RULES de ui.js) —
 *   sin cambios necesarios en ui.js/edit-system.js: EDITABLE_FIELDS ya
 *   expone MARCHAMO 1-5 como campos editables en el drawer.
 *
 * Dependencias:
 *   - State (core/state.js) — lee rows ya vía parámetro, pero escribe
 *     State.sveHasCritical / sveHasWarnings / sveLastQuality
 *   - getMapped (core/constants.js) — resuelve valores de columna
 */
import { State } from '../../core/state.js';
import { getMapped } from '../../core/constants.js';

export const SVE_CRIT = 'CRÍTICA';
export const SVE_WARN = 'ADVERTENCIA';
export const SVE_INFO = 'INFORMATIVA';

export const SVE_ICONS = {
  'dup_march':'🔖','dup_march_ruta':'🔁','dup_march_self':'♻️','missing_ruta':'🔴','missing':'🟠',
  'no_march':'🔴','zero_tar':'📐','high_tar':'📐','no_pdf':'🟡',
  'no_fac':'ℹ️','bad_march':'ℹ️','integrity':'🔗','no_ventana':'📇','no_pool':'🚚','cat_dup':'🗂️','time_anomaly':'⏱️',
  'no_cita':'📅','pdf_ambiguous':'🧩','dette_sin_pdf':'🚫'
};

/**
 * Ejecuta las reglas de validación sobre las rows del merge.
 *
 * @param {Array<object>} rows — normalmente State.merged
 * @param {number} [screenCount] — conteo de entregas que el caller
 *   considera "lo que muestra la pantalla" (típicamente
 *   State.xlsData.length, una fila de RUTEO NUEVO = una entrega) —
 *   usado únicamente por la regla K (integridad UI vs memoria). Si se
 *   omite, la regla K no se evalúa.
 * @param {number} [excludedCount] — NUEVO (jul-2026): entregas
 *   excluidas por el usuario (ver Events.confirmExcludedDette /
 *   State.excludedCount) que se filtraron en ESTA corrida de
 *   runMerge() antes de llegar a `rows`. Se resta de screenCount antes
 *   de comparar contra rows.length — una diferencia que se explica por
 *   completo con exclusiones confirmadas ya NO es una discrepancia
 *   real, es el comportamiento esperado (ver core/state.js →
 *   excludedCount).
 * @returns {null|{
 *   issues: Array<object>,
 *   quality: number,
 *   nCrit: number, nWarn: number, nInfo: number, nPass: number
 * }} — null si rows está vacío (el caller debe llamar UI.resetSVE() en ese caso)
 */
export function runSVE(rows, screenCount, excludedCount) {
  if (!rows || !rows.length) return null;

  const raw = [];
  // rawAdd signature: (sev, rule, ruta, field, desc, action, extra, rowIds?, dette?)
  // rowIds: optional array of _rowId values identifying the exact merged row(s)
  // this issue refers to. When provided, EditSystem uses them for precise lookup
  // instead of falling back to RUTA string matching.
  // dette: optional — entrega (DETTE) a la que pertenece la incidencia, para que
  // el usuario identifique exactamente qué línea de la ruta debe corregir sin
  // tener que buscar manualmente entre todas las entregas.
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

  // A: Marchamos duplicados — CUALQUIER repetición del mismo marchamo
  // es un error, sin importar si ocurre entre rutas distintas, entre
  // entregas de la MISMA ruta, o dentro de la MISMA entrega (dos
  // posiciones MARCHAMO N). Ver nota de cabecera "CAMBIO (ago-2026 —
  // refuerzo de detección...)" para el detalle de cada caso.
  //
  // marchMap guarda SOLO la primera aparición de cada marchamo: además
  // de ruta/rowId/dette (ya existentes), ahora también `slot` (número
  // de posición MARCHAMO N) — necesario para distinguir "dos entregas
  // distintas de la misma ruta" de "dos posiciones de la misma
  // entrega" y para poder describir cuáles dos posiciones chocan en el
  // mensaje de dup_march_self.
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
          // Caso original — dos rutas distintas. Sin cambios.
          rawAdd(SVE_CRIT,'dup_march', ruta, `MARCHAMO ${m}`,
            `Marchamo ${marc} asignado a ruta ${ruta} (entrega ${dette||'—'}) y también a ruta ${prev.ruta} (entrega ${prev.dette||'—'}).`,
            'Confirma con la documentación cuál ruta lleva este marchamo.',
            marc,
            [prev.rowId, r._rowId].filter(Boolean),
            dette);
        } else if (prev.rowId === r._rowId) {
          // NUEVO (ago-2026) — mismo marchamo repetido DOS VECES dentro
          // de la MISMA entrega (dos posiciones MARCHAMO N). Casi
          // siempre un error de captura (valor pegado/copiado dos
          // veces) — no bloquea la exportación, pero se marca para
          // verificar contra el PDF.
          rawAdd(SVE_WARN,'dup_march_self', ruta, `MARCHAMO ${m}`,
            `Ruta ${ruta} · Entrega ${dette||'—'}: el marchamo ${marc} está repetido en MARCHAMO ${prev.slot} y MARCHAMO ${m} de la misma entrega.`,
            'Verifica el PDF de esta entrega — probablemente un marchamo se capturó dos veces por error.',
            marc,
            [r._rowId],
            dette);
        } else {
          // NUEVO (ago-2026) — mismo marchamo en DOS ENTREGAS DISTINTAS
          // de la MISMA ruta. Mismo problema de fondo que dup_march
          // (un sello físico no puede estar en dos cargas) — bloquea
          // la exportación igual que el caso entre rutas distintas.
          rawAdd(SVE_CRIT,'dup_march_ruta', ruta, `MARCHAMO ${m}`,
            `Ruta ${ruta}: el marchamo ${marc} está asignado tanto a la entrega ${prev.dette||'—'} como a la entrega ${dette||'—'} — un marchamo no puede repetirse ni dentro de la misma ruta.`,
            'Verifica el PDF de ambas entregas y corrige el marchamo que no corresponda.',
            marc,
            [prev.rowId, r._rowId].filter(Boolean),
            dette);
        }
      } else {
        marchMap.set(marc, { ruta, rowId: r._rowId, dette, slot: m });
      }
    }
  });

  // B (RETIRADA jul-2026): "Tarimas idénticas en múltiples líneas de la
  // misma ruta" — ver nota de cabecera "CAMBIO (jul-2026 — revisión de
  // reglas operativas)". Confirmado por EduarDo: es un patrón normal
  // del día a día, no una señal de PDF mal asignado. Se elimina la
  // regla y su cómputo (lineCount/tarMap) por completo — sin reemplazo.

  // C: Registros sin RUTA
  let noRutaCnt = 0;
  rows.forEach(r => { if (!String(getMapped(r,'RUTA')||'').trim()) noRutaCnt++; });
  if (noRutaCnt) rawAdd(SVE_CRIT,'missing_ruta','','RUTA',
    `${noRutaCnt} registro${noRutaCnt>1?'s':''} sin número de RUTA.`,
    'Revisa el Excel macro: busca filas con columna RUTA vacía.',
    noRutaCnt > 1 ? `×${noRutaCnt}` : '');

  // D1: Operador y Licencia — atributos de la RUTA COMPLETA (mismo dato
  // para todas sus entregas), consolidados SOLO por RUTA — sin dette.
  //
  // CAMBIO (Correcciones — mockup jul-2026): antes ambos campos se
  // combinaban en UN solo issue con field="Operador, Licencia" cuando
  // faltaban los dos a la vez. Se separan en DOS issues independientes
  // — uno por campo — porque la pantalla de Correcciones mapea cada
  // issue a UNA tarjeta de corrección rápida con UN campo editable; un
  // field compuesto no es editable con un solo input. Efecto
  // secundario positivo: el panel SVE (legacyPanel) ahora también
  // muestra Operador y Licencia como incidencias separadas, más
  // preciso que el texto combinado anterior.
  const missingOperadorByRuta = new Map();
  const missingLicByRuta      = new Map();
  matched.forEach(r => {
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    if (!ruta) return;
    if (!String(getMapped(r,'OPERADOR')||'').trim()) {
      if (!missingOperadorByRuta.has(ruta)) missingOperadorByRuta.set(ruta, { rowIds: new Set() });
      if (r._rowId) missingOperadorByRuta.get(ruta).rowIds.add(r._rowId);
    }
    if (!String(getMapped(r,'LIC.')||'').trim()) {
      if (!missingLicByRuta.has(ruta)) missingLicByRuta.set(ruta, { rowIds: new Set() });
      if (r._rowId) missingLicByRuta.get(ruta).rowIds.add(r._rowId);
    }
  });
  missingOperadorByRuta.forEach(({ rowIds }, ruta) => rawAdd(SVE_CRIT,'missing', ruta, 'OPERADOR',
    `Ruta ${ruta}: falta Operador.`,
    'Revisa el PDF de esta ruta.', '', [...rowIds]));
  missingLicByRuta.forEach(({ rowIds }, ruta) => rawAdd(SVE_WARN,'missing', ruta, 'LIC.',
    `Ruta ${ruta}: falta Licencia.`,
    'Agrega al operador en el catálogo.', '', [...rowIds]));

  // D2: Tarimas — varía por línea, consolidado por RUTA + ENTREGA (DETTE)
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
  missingTarimasByRutaDette.forEach(({ ruta, dette, rowIds }) => rawAdd(SVE_CRIT,'missing', ruta, 'TARIMAS',
    `Ruta ${ruta} · Entrega ${dette||'—'}: campo incompleto — Tarimas.`,
    'Revisa el PDF de esta ruta.', '', [...rowIds], dette));

  // D-bis: CITA pendiente — SIEMPRE SVE_INFO, nunca bloquea la exportación
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

  // E: Sin marchamo principal — consolidado por RUTA + ENTREGA (DETTE).
  // Esta regla ahora también cubre el caso "marchamo con formato
  // inválido en el PDF, dejado vacío por diseño" (ver processors/pdf.js
  // y regla J más abajo) — MARCHAMO 1 queda vacío igual que si el PDF
  // nunca lo hubiera traído, así que esta regla ya es la incidencia
  // ACCIONABLE (quickfix) para ese caso, sin necesidad de duplicar lógica.
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

  // F: Tarimas = 0 — consolidado por RUTA + ENTREGA (DETTE).
  // CAMBIO (Correcciones — mockup jul-2026): antes se consolidaba solo
  // por RUTA, inconsistente con D2 (tarimas FALTANTES), que ya agrupa
  // por entrega. Si una ruta con varias entregas tiene tarimas=0 en
  // una sola línea, ahora se identifica exactamente cuál — mismo
  // criterio para las tres reglas de tarimas (D2/F/G).
  const zeroTarByRutaDette = new Map();
  matched.forEach(r => {
    const ruta  = String(getMapped(r,'RUTA')||'').trim();
    const dette = String(getMapped(r,'DET')||'').trim();
    const tar   = parseInt(String(getMapped(r,'TARIMAS')||'0').replace(/\D/g,''), 10);
    if (isNaN(tar) || tar === 0) {
      const groupKey = ruta + '||' + dette;
      if (!zeroTarByRutaDette.has(groupKey)) zeroTarByRutaDette.set(groupKey, { ruta, dette, rowIds: new Set() });
      const e = zeroTarByRutaDette.get(groupKey);
      if (r._rowId) e.rowIds.add(r._rowId);
    }
  });
  zeroTarByRutaDette.forEach(({ ruta, dette, rowIds }) => rawAdd(SVE_WARN,'zero_tar', ruta,'TARIMAS',
    `Ruta ${ruta} · Entrega ${dette||'—'}: tarimas = 0 o no detectadas.`,
    'Confirma que el PDF esté correctamente asignado a esta entrega.',
    '', [...rowIds], dette));

  // G: Tarimas > 60 — consolidado por RUTA + ENTREGA (DETTE). Mismo
  // cambio que F — ver nota arriba.
  const highTarByRutaDette = new Map();
  matched.forEach(r => {
    const ruta  = String(getMapped(r,'RUTA')||'').trim();
    const dette = String(getMapped(r,'DET')||'').trim();
    const tar   = parseInt(String(getMapped(r,'TARIMAS')||'0').replace(/\D/g,''), 10);
    if (tar > 60) {
      const groupKey = ruta + '||' + dette;
      const prev = highTarByRutaDette.get(groupKey) || { ruta, dette, tar: 0, rowIds: new Set() };
      if (tar > prev.tar) prev.tar = tar;
      if (r._rowId) prev.rowIds.add(r._rowId);
      highTarByRutaDette.set(groupKey, prev);
    }
  });
  highTarByRutaDette.forEach(({ ruta, dette, tar, rowIds }) => rawAdd(SVE_WARN,'high_tar', ruta,'TARIMAS',
    `Ruta ${ruta} · Entrega ${dette||'—'}: tarimas inusualmente altas (${tar}).`,
    'Confirma si es una carga doble o error de lectura de PDF.',
    `${tar} tar.`,
    [...rowIds], dette));

  // H: Rutas sin PDF — una alerta por ruta. Excluye filas marcadas
  // _pdfAmbiguous (ver regla 'pdf_ambiguous' más abajo) y
  // _pdfDetteAusente (ver regla 'dette_sin_pdf' más abajo) — ambas ya
  // tienen un mensaje más preciso que reportarlas también aquí
  // duplicaría el aviso con un texto genérico y menos útil.
  const noPdfByRuta = new Map();
  rows.forEach(r => {
    if (r._matched) return;
    if (r._pdfAmbiguous) return;
    if (r._pdfDetteAusente) return;
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

  // H-bis: PDF ambiguo — existen dos o más bloques de carga candidatos
  // para esta ruta, ninguno matcheó específicamente por factura/DETTE,
  // Y el DETTE de esta fila SÍ aparece entre los destinos de esos
  // bloques (ver processors/merge.js para el detalle de la detección).
  // NUNCA se adivina cuál corresponde — se reporta como CRÍTICA en vez
  // de asignar datos de otra entrega. Caso distinto de 'dette_sin_pdf'
  // (regla H-ter, más abajo): ahí el DETTE NO aparece en ningún
  // bloque — no hay nada que "adivinar entre candidatos", la entrega
  // simplemente no está en el PDF.
  const pdfAmbiguousByRuta = new Map();
  rows.forEach(r => {
    if (!r._pdfAmbiguous) return;
    const ruta = String(getMapped(r,'RUTA')||'').trim();
    if (!pdfAmbiguousByRuta.has(ruta)) pdfAmbiguousByRuta.set(ruta, { cnt: 0, rowIds: new Set() });
    const e = pdfAmbiguousByRuta.get(ruta);
    e.cnt++;
    if (r._rowId) e.rowIds.add(r._rowId);
  });
  pdfAmbiguousByRuta.forEach(({ cnt, rowIds }, ruta) => rawAdd(SVE_CRIT,'pdf_ambiguous', ruta,'OPERADOR / LIC. / MARCHAMOS / FAC.',
    `Ruta ${ruta}: existen múltiples bloques de carga en el PDF y no se puede determinar con certeza cuál corresponde a esta entrega${cnt>1?` (${cnt} entregas)`:''}.`,
    'Verifica manualmente el DETTE/factura de esta entrega contra el PDF y corrige los campos.',
    cnt>1?`${cnt} entregas`:'',
    [...rowIds]));

  // H-ter: DETTE ausente del PDF — NUEVO (jul-2026, ver nota de
  // cabecera "CAMBIO (jul-2026 — nueva regla 'dette_sin_pdf'...)").
  // A diferencia de H-bis (ambigüedad real, el DETTE sí está en el PDF
  // pero no se sabe en cuál bloque), aquí NINGÚN bloque de PDF de la
  // ruta corresponde a esta entrega. Caso real confirmado con EduarDo:
  // la entrega se quedó por ocupación y ya no se generó su bloque en
  // el PDF (el PDF lo emite la misma plataforma WTMS). Se ofrece
  // confirmar la exclusión completa del día operativo — ver
  // events.js → confirmExcludedDette(), que elimina la fila POR
  // COMPLETO de State.merged (y por lo tanto del Excel final y del
  // historial de Supabase) — o revisar manualmente por si el PDF
  // debería traerla.
  const detteSinPdfByRutaDette = new Map();
  rows.forEach(r => {
    if (!r._pdfDetteAusente) return;
    const ruta  = String(getMapped(r,'RUTA')||'').trim();
    const dette = String(getMapped(r,'DET')||'').trim();
    const groupKey = ruta + '||' + dette;
    if (!detteSinPdfByRutaDette.has(groupKey)) detteSinPdfByRutaDette.set(groupKey, { ruta, dette, rowIds: new Set() });
    const e = detteSinPdfByRutaDette.get(groupKey);
    if (r._rowId) e.rowIds.add(r._rowId);
  });
  detteSinPdfByRutaDette.forEach(({ ruta, dette, rowIds }) => rawAdd(SVE_WARN,'dette_sin_pdf', ruta,
    'OPERADOR / LIC. / TARIMAS / MARCHAMOS / FAC. / CITA',
    `Ruta ${ruta} · Entrega ${dette||'—'}: no aparece ningún bloque de PDF para esta entrega — ¿se quedó por ocupación y ya no se va a realizar?`,
    'Confirma si la entrega debe excluirse del día operativo, o revisa manualmente si el PDF debería traerla.',
    '', [...rowIds], dette));

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

  // J: Marchamos con formato incorrecto — REESCRITA (integridad de
  // datos, jul-2026). Antes escaneaba MARCHAMO 1-5 buscando texto con
  // formato inválido; ahora eso ya nunca ocurre — pdf.js valida cada
  // marchamo al extraerlo y deja vacía cualquier posición inválida (ver
  // processors/pdf.js, extracción tolerante por campo). Esta regla lee
  // en cambio r._marchamoIssues (poblado en merge.js desde
  // pdfRow.marchamoIssues): el texto CRUDO que se intentó leer del PDF
  // y no pasó la validación de formato — puramente informativa, para
  // que el usuario pueda verificar contra el documento original. La
  // incidencia ACCIONABLE (el campo ahora vacío) la cubre
  // automáticamente la regla E (no_march), que ya es quickfix.
  const badMarchByRutaDette = new Map();
  matched.forEach(r => {
    const issues = r._marchamoIssues || [];
    if (!issues.length) return;
    const ruta  = String(getMapped(r,'RUTA')||'').trim();
    const dette = String(getMapped(r,'DET')||'').trim();
    const groupKey = ruta + '||' + dette;
    if (!badMarchByRutaDette.has(groupKey)) badMarchByRutaDette.set(groupKey, { ruta, dette, vals: new Set(), rowIds: new Set() });
    const e = badMarchByRutaDette.get(groupKey);
    issues.forEach(iss => e.vals.add(iss.raw));
    if (r._rowId) e.rowIds.add(r._rowId);
  });
  badMarchByRutaDette.forEach(({ ruta, dette, vals, rowIds }) => {
    const sample = [...vals].slice(0,3).join(', ') + (vals.size>3?'…':'');
    rawAdd(SVE_INFO,'bad_march', ruta,'MARCHAMOS',
      `Ruta ${ruta} · Entrega ${dette||'—'}: ${vals.size} marchamo${vals.size>1?'s':''} con formato inválido detectado en el PDF (${sample}) — se dejó vacío, no se copió de ninguna otra entrega.`,
      'El texto extraído no cumple el formato esperado (5-6 dígitos). Verifica el PDF original y corrige manualmente el campo Marchamo.',
      vals.size>1?`×${vals.size}`:'',
      [...rowIds], dette);
  });

  // L: Ventana de Recibo — DETTE no encontrado (consolidado por ruta).
  // CAMBIO (jul-2026): SVE_WARN → SVE_INFO — ver nota de cabecera
  // "CAMBIO (jul-2026 — revisión de reglas operativas)". No existe
  // campo editable para FORMATO/TIENDA/ESTADO en EDITABLE_FIELDS — la
  // única corrección real es actualizar el catálogo Ventana de Recibo
  // en Administración, fuera del alcance del operador de captura.
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
  noVentanaByRuta.forEach(({ cnt, rowIds }, ruta) => rawAdd(SVE_INFO,'no_ventana', ruta,'FORMATO / TIENDA / ESTADO',
    `Ruta ${ruta}: DETTE no encontrado en el catálogo Ventana de Recibo.`,
    'Verifica el DETTE en RUTEO NUEVO o actualiza el catálogo en Administración.',
    cnt>1?`×${cnt}`:'',
    [...rowIds]));

  // M: Pool Real — ECO/REMOLQUE no encontrado (consolidado por ruta).
  // CAMBIO (jul-2026): SVE_WARN → SVE_INFO — mismo motivo que la regla L.
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
    rawAdd(SVE_INFO,'no_pool', ruta, fl,
      `Ruta ${ruta}: ${fl} no encontrado en el catálogo Pool Real.`,
      'Verifica TRACTOR/REMOLQUE (UNIDAD) en RUTEO NUEVO o actualiza el catálogo en Administración.',
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

  // K: Integridad "pantalla" vs memoria — ver nota de cabecera "Fix regla K".
  // screenCount llega como parámetro (antes se leía de #bdgXLS en el DOM).
  // CAMBIO (jul-2026): 1) "rutas" → "entregas" en el mensaje (ver nota de
  // cabecera "CAMBIO (jul-2026 — regla K...)"; 2) se descuentan las
  // exclusiones confirmadas por el usuario en ESTA corrida (excludedCount,
  // ver merge.js/state.js) antes de comparar — una DETTE cancelada y
  // confirmada por el usuario reduce legítimamente el conteo esperado; no
  // es un error del sistema y no debe bloquear la exportación con una
  // alerta crítica falsa.
  if (screenCount) {
    const expected = screenCount - (excludedCount || 0);
    if (expected !== rows.length) {
      const exclNote = excludedCount
        ? ` (${screenCount} del Excel − ${excludedCount} excluida${excludedCount > 1 ? 's' : ''} confirmada${excludedCount > 1 ? 's' : ''})`
        : '';
      rawAdd(SVE_CRIT,'integrity','','CONTEO',
        `Discrepancia: se esperaban ${expected} entrega${expected !== 1 ? 's' : ''}${exclNote}, memoria contiene ${rows.length}.`,
        'Recarga la página y vuelve a procesar los archivos.',
        `Excel:${expected}/MEM:${rows.length}`);
    }
  }

  // ── DEDUP ENGINE ──
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
