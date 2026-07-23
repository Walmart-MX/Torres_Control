/**
 * processors/merge.js
 * MERGE ENGINE — cruza los datos de las cuatro fuentes (Excel/RUTEO,
 * PDFs, concentrado de facturas, panel de despacho) y produce
 * State.merged: el array que alimenta la tabla, el SVE y la exportación.
 *
 * [... comentarios previos sin cambios ...]
 *
 * FIX (automatización SW — post análisis arquitectónico): se agrega el
 * cálculo de _SW (Semana Walmart, calendario fiscal 4-5-4) por fila.
 * DECISIÓN: la fecha de referencia es row['FECHA'] — la columna A del
 * Excel RUTEO NUEVO, ya corregida de zona horaria por _fixExcelDateRow
 * en excel.js — NUNCA el reloj del equipo. Esto hace que la SW (y a
 * futuro, cualquier lógica de calendario fiscal) sea inmune a en qué
 * momento del día se ejecuta SmartDispatch: no importa si el usuario
 * procesa antes o después de medianoche, la SW siempre corresponde al
 * día operativo real que trae el Excel, no al instante de ejecución.
 * Si la fecha falta o cae fuera de los años fiscales configurados en
 * fiscal-calendar.js, la fila queda con _SW vacío y se advierte en
 * consola — no se detiene el merge del resto de las rutas.
 *
 * FIX (algoritmo de match — jul-2026, eliminación de fallback
 * posicional): el cruce PDF↔RUTEO NUEVO ya usaba Ruta+Factura y
 * Ruta+DETTE (Map indexado, ver State.pdfData en events.js →
 * handlePDFs) para los primeros tres intentos de match — esos SIEMPRE
 * estuvieron correctamente scoped a la ruta y NUNCA fueron
 * posicionales. El único punto realmente posicional era un cuarto
 * intento ("toma la siguiente entrega libre del PDF de esa misma
 * ruta") que se ejecutaba cuando ningún DETTE/factura coincidía —
 * típicamente porque una tienda fue cancelada después de generarse el
 * PDF y ya no aparece en Ruteo Nuevo, o viceversa. Ese fallback
 * desplazaba tarimas/facturas/marchamos hacia la entrega equivocada.
 * SE ELIMINA POR COMPLETO — ver bloque removido más abajo. Si ninguno
 * de los tres intentos por clave coincide, la fila queda sin PDF
 * (_matched=false, campos vacíos) para revisión manual, en vez de
 * inventar una asociación. Las entregas del PDF que quedan sin
 * consumir se exponen en State.pdfOrphans (ver bloque nuevo al final
 * de runMerge) y se reportan como incidencia informativa en el SVE
 * (features/validation/sve.js, regla 'pdf_orphan').
 *
 * FIX (cruce con Reporte WTMS — jul-2026): runMerge() nunca calculaba
 * _ID_RETORNO/_CARTA_PORTE/_wtmsMatched/_wtmsAmbiguous pese a que
 * sve.js (reglas P/Q) y editing/edit-system.js ya asumían esos campos
 * como parte del contrato de State.merged. Se agrega el bloque de
 * cruce Status.ID'S MASTER == WTMS.ID de la carga inmediatamente
 * después del bloque de despRow — ver comentario específico en el
 * loop principal para el detalle del contrato.
 *
 * Dependencias:
 *   - State (core/state.js)
 *   - FactCache (features/fact-cache.js)
 *   - getFiscalWeek (core/fiscal-calendar.js)
 */

import { State } from '../core/state.js';
import { COL_RUTA, COL_DETTE_E, COL_DETTE_F, COL_FACT, MAX_MARCH } from '../core/constants.js';
import { FactCache } from '../features/fact-cache.js';
import { normOp } from '../utils/format.js';
import { getFiscalWeek } from '../core/fiscal-calendar.js';
import { resolveExcelDate, dayNameEs } from '../utils/date.js';

// NUEVO
import { buildIndices, enrichRow } from '../features/catalogs/enrichment-engine.js';
import { computeTimes } from '../core/time-engine.js';

function _resolveFecha(row) {
  const raw = row['FECHA'];
  if (!raw && raw !== 0) return null;

  const d = raw instanceof Date ? raw : new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function runMerge() {

  if (!State.xlsData || State.pdfData.size === 0) return;

  State.merged = [];

  // ============================================================
  // NUEVO
  // Construcción única de índices de catálogos
  // ============================================================
  const {
    indices: catalogIndices,
    duplicates: catalogDuplicates
  } = buildIndices(State.catalogs || {});

  State.catalogIndices = catalogIndices;
  State.catalogDuplicates = catalogDuplicates;
  // ============================================================

  const usedPdfRows = new Set();

  for (const row of State.xlsData) {

    const ruta    = String(row[COL_RUTA] || '').trim();
    const detteF  = String(row[COL_DETTE_F] || '').trim();
    const factXls = String(row[COL_FACT] || '').trim();

    let pdfRow = null;
    let pdfMatchType = 'none';

    // ── Intento 1: match por Ruta + Factura ──
    // Clave ya scoped a la ruta (ver State.pdfData en events.js →
    // handlePDFs). La factura es el identificador más específico
    // disponible — cuando coincide, es más confiable que el DETTE.
    if (factXls) {
      const r = State.pdfData.get(ruta + '|' + factXls);
      if (r && !usedPdfRows.has(r)) {
        pdfRow = r;
        pdfMatchType = 'specific';
      }
    }

    // ── Intento 2: match por Ruta + DETTE.1 (Destino) ──
    if (!pdfRow && detteF) {
      const r = State.pdfData.get(ruta + '|D|' + detteF);
      if (r && !usedPdfRows.has(r)) {
        pdfRow = r;
        pdfMatchType = 'specific';
      }
    }

    // ── Intento 3: match por Ruta + DETTE (Destino) ──
    if (!pdfRow) {
      const detteE = String(row[COL_DETTE_E] || '').trim();

      if (detteE) {
        const r = State.pdfData.get(ruta + '|D|' + detteE);

        if (r && !usedPdfRows.has(r)) {
          pdfRow = r;
          pdfMatchType = 'specific';
        }
      }
    }

    // ── ELIMINADO: fallback posicional ──
    // Antes, si ninguno de los tres intentos anteriores encontraba
    // coincidencia, se tomaba "la siguiente entrega libre del PDF de
    // esa misma ruta" sin comparar Destino — esto es lo que causaba
    // el desplazamiento de datos entre entregas cuando el Ruteo Nuevo
    // y el PDF no traían exactamente las mismas tiendas en el mismo
    // orden (ej. tienda cancelada). Se retira por completo: si no hay
    // match por Ruta+Factura ni por Ruta+Destino, la fila queda sin
    // PDF — OPERADOR/TARIMAS/MARCHAMOS permanecen vacíos (ver rama
    // `else` más abajo) para que el usuario la revise manualmente.

    if (pdfRow) {
      usedPdfRows.add(pdfRow);
    }

    const factKey = pdfRow ? String(pdfRow.factura || '').trim() : '';

    let factRow = factKey
      ? (State.factData.get(factKey) || null)
      : null;

    let factFromCache = false;

    if (!factRow && factKey) {

      const cached = FactCache.lookup(factKey);

      if (cached) {
        factRow = cached;
        factFromCache = true;
      }

    }

    const despRow = ruta
      ? (State.despData.get(ruta) || null)
      : null;

    const _rowId = ruta + '||' + (detteF || String(State.merged.length));

    const nr = {
      ...row,
      _rowId,
      _matched: !!pdfRow,
      _factMatched: !!factRow,
      _despMatched: !!despRow
    };

    // ----------------------------------------------------
    // SW + DIA
    // ----------------------------------------------------

    const fechaRef = resolveExcelDate(row['FECHA']);

    let sw = '';
    let dia = '';

    if (fechaRef) {

      dia = dayNameEs(fechaRef);

      try {

        sw = getFiscalWeek(fechaRef).sw;

      } catch (e) {

        console.warn(
          '[merge] SW no calculada para ruta',
          ruta,
          '—',
          e.message
        );

      }

    } else {

      console.warn(
        '[merge] FECHA no resoluble para ruta',
        ruta,
        '— SW y DIA quedarán vacíos.'
      );

    }

    nr['_SW'] = sw;
    nr['_DIA'] = dia;

    if (pdfRow) {

      nr['OPERADOR'] = pdfRow.operador;
      nr['TARIMAS'] = parseInt(pdfRow.tarimas, 10) || pdfRow.tarimas;

      for (let m = 0; m < MAX_MARCH; m++) {
        nr['MARCHAMO ' + (m + 1)] = pdfRow.marchamos[m] || '';
      }

      nr['FAC_PDF'] = pdfRow.factura;
      nr['DEST_PDF'] = pdfRow.destino;
      nr['_CITA_PDF'] =
        (pdfMatchType === 'specific' && pdfRow.cita)
          ? pdfRow.cita
          : '';

      nr['CITA'] = nr['_CITA_PDF'];
      nr['_LIC'] = State.catalog.get(normOp(pdfRow.operador)) || '';
      nr['_HR_DESP_PDF'] = pdfRow.hrDespacho || '';

    } else {

      nr['OPERADOR'] = '';
      nr['TARIMAS'] = '';

      for (let m = 0; m < MAX_MARCH; m++) {
        nr['MARCHAMO ' + (m + 1)] = '';
      }

      nr['_CITA_PDF'] = '';
      nr['CITA'] = '';
      nr['_LIC'] = '';
      nr['_HR_DESP_PDF'] = '';

    }

    if (factRow) {

      nr['_GLS'] = factRow.gls;
      nr['_HORA_FACT'] = factRow.horaFact;
      nr['_factSource'] = factFromCache ? 'cache' : 'current';
      nr['_factCacheDate'] = factFromCache
        ? (factRow.date || '')
        : '';

    } else {

      nr['_GLS'] = '';
      nr['_HORA_FACT'] = '';
      nr['_factSource'] = '';
      nr['_factCacheDate'] = '';

    }

    if (despRow) {

      nr['_HR_DESP'] = despRow.hrDesp;
      nr['_CASETA'] = despRow.caseta;
      nr['_WTMS'] = despRow.wtms;
      nr['_ID_IDA'] = despRow.idIda;

    } else {

      nr['_HR_DESP'] = '';
      nr['_CASETA'] = '';
      nr['_WTMS'] = '';
      nr['_ID_IDA'] = '';

    }

    // ============================================================
    // NUEVO — Cruce con Reporte WTMS (4ª fuente obligatoria, jul-2026)
    // Join key: Status.ID'S MASTER (despRow.idIda) == WTMS.ID de la
    // carga (State.wtmsData, indexado en processors/wtms.js).
    //
    // ID RETORNO / CARTA PORTE SIEMPRE se sobreescriben desde el WTMS
    // — nunca desde el Excel — por eso este bloque va DESPUÉS del
    // bloque de despRow y no se mezcla con él, aunque ambos dependan
    // del mismo despRow para obtener el ID'S MASTER.
    //
    // Contrato con sve.js (reglas P/Q) y editing/edit-system.js
    // (EDITABLE_FIELDS '_ID_RETORNO'/'_CARTA_PORTE'):
    //   _wtmsMatched   — false si el ID'S MASTER no encontró
    //                    coincidencia en el WTMS (regla P, advertencia,
    //                    no bloquea — ID RETORNO queda 'N/A').
    //   _wtmsAmbiguous — true si el WTMS trae doble dato separado por
    //                    coma (ej. "1234,4321") en Siguiente Carga o
    //                    Carte Porte (regla Q, crítica, bloquea hasta
    //                    resolución manual). Mismo criterio de detección
    //                    que usa EditSystem.saveAndRevalidate() al
    //                    revalidar tras una corrección manual.
    // ============================================================
    const idIdaKey = despRow ? String(despRow.idIda || '').trim() : '';
    const wtmsRow  = idIdaKey ? (State.wtmsData.get(idIdaKey) || null) : null;

    if (wtmsRow) {

      const siguienteCarga = String(wtmsRow.siguienteCarga || '').trim();
      const cartePorteVal  = String(wtmsRow.carteporte || '').trim();

      nr['_ID_RETORNO']    = siguienteCarga || 'N/A';
      nr['_CARTA_PORTE']   = cartePorteVal;
      nr['_wtmsMatched']   = true;
      nr['_wtmsAmbiguous'] = siguienteCarga.includes(',') || cartePorteVal.includes(',');

    } else {

      nr['_ID_RETORNO']    = 'N/A';
      nr['_CARTA_PORTE']   = '';
      nr['_wtmsMatched']   = false;
      nr['_wtmsAmbiguous'] = false;

    }

    // ============================================================
    // NUEVO
    // Enriquecimiento desde catálogos maestros
    // ============================================================

    nr['_enrichMisses'] = enrichRow(
      nr,
      row,
      catalogIndices
    );

    // ============================================================
    // NUEVO
    // Cálculo de tiempos
    // ============================================================

    nr['_timeAnomalies'] = computeTimes(nr);

    State.merged.push(nr);

  }

  // ============================================================
  // NUEVO — Resumen del algoritmo de Match por Destino (jul-2026)
  // Entregas del PDF que NUNCA fueron consumidas por ninguna fila de
  // Ruteo Nuevo durante el loop anterior — ni por Factura ni por
  // Destino, dentro de su propia ruta. Ya no se les asigna nada por
  // posición (ver eliminación del fallback arriba); en su lugar se
  // listan aquí para que el SVE las reporte como incidencia revisable
  // (features/validation/sve.js, regla 'pdf_orphan'). Típicamente
  // indica una tienda cancelada que quedó en el PDF pero no en el
  // Ruteo Nuevo, o un DETTE que no coincide con el Destino del PDF.
  //
  // State.pdfData tiene DOS claves por entrega (factura y destino) —
  // se usa un Set sobre los VALORES para deduplicar por objeto real,
  // no por clave.
  // ============================================================
  const allPdfRows = new Set(State.pdfData.values());
  State.pdfOrphans = [...allPdfRows]
    .filter(r => !usedPdfRows.has(r))
    .map(r => ({ ruta: r.ruta, destino: r.destino, factura: r.factura }));

  const totalConRuta = State.merged.filter(r => String(r['RUTA'] || '').trim()).length;
  const encontradas   = State.merged.filter(r => r._matched).length;
  const sinCoincidir  = totalConRuta - encontradas;

  console.info(
    `[Merge] Resumen del match por Ruta+Destino: ${encontradas} entregas encontradas, ` +
    `${sinCoincidir} sin coincidencia en Ruteo Nuevo, ${State.pdfOrphans.length} registro(s) ` +
    `del PDF sin asociar.`
  );
  if (State.pdfOrphans.length) {
    console.info(
      '[Merge] Detalle de registros PDF sin asociar:',
      State.pdfOrphans.map(o => `Ruta ${o.ruta} · Destino ${o.destino}${o.factura ? ' · Fact. ' + o.factura : ''}`).join(' | ')
    );
  }

}
