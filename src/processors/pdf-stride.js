/**
 * processors/pdf-stride.js
 * Extracción y parseo de los PDFs de viajes de STRIDE — la plataforma
 * que va a reemplazar a WTMS (ver processors/pdf.js para el parser
 * vigente de WTMS, que NO se toca ni se retira todavía).
 *
 * Analizado con EduarDo sobre docs/STRIDE.pdf (muestra real, 10
 * páginas, 1 viaje, oct-2026) — el formato es ESTRUCTURALMENTE más
 * simple que WTMS porque CADA PÁGINA = UNA SOLA ENTREGA ("Parada N de
 * M"): campos etiquetados explícitos, un solo destino/factura/
 * marchamo por página. Eso elimina de raíz la categoría de bugs que
 * más costó resolver en pdf.js (filas vecinas compartiendo página,
 * ambigüedad de a qué entrega pertenece una anotación) — ver pruebas
 * reales documentadas abajo.
 *
 * ESTRUCTURA CONFIRMADA del PDF:
 *   - N páginas "Parada X de N": una por parada (ida, Tipo de Carga
 *     STR/PLT) — incluye el tramo de retorno final dentro del MISMO
 *     documento (Origen/Destino invertidos STORE→DC).
 *   - 1 página final "Información de la carga": tabla resumen de
 *     TODAS las paradas del viaje — redundante con las páginas
 *     individuales, pero el equipo TAMBIÉN corrige marchamos ahí (ver
 *     más abajo), así que hay que leerla.
 *
 * NOMBRE DEL ARCHIVO (confirmado con EduarDo, oct-2026): sigue siendo
 * el número de ruta desnudo (ej. "2105.pdf", "2405.pdf") — NO se ha
 * confirmado si Stride puede combinar más de una ruta en un mismo PDF
 * (a diferencia de WTMS, que sí lo hace). Por ahora se asume 1 PDF = 1
 * viaje = 1 ruta. Si en el futuro aparece un caso combinado, replicar
 * aquí el detector de "ruta unificada" de pdf.js — fuera de alcance
 * hoy, YAGNI.
 *
 * ANOTACIONES — tres reglas validadas con pruebas reales deliberadas
 * (moviendo citas y marchamos por toda la página, variando separadores,
 * duplicando correcciones en dos lugares a la vez):
 *
 *   1) CITA (fecha+hora en la página de una Parada): pertenece SIEMPRE
 *      a la entrega de ESA página, sin importar su posición X/Y. Se
 *      probó moviéndola a los cuatro rincones de la página y el match
 *      no cambia — a diferencia de WTMS, donde la posición sí importa
 *      porque varias entregas comparten renglones en la misma página.
 *
 *   2) ZONA DE ENCABEZADO (solo página 1): la esquina donde el equipo
 *      anota ruta/operador/certificados/temperatura (ej. "RUTA 2205\n
 *      EDUARDO\nTIF/FITO 3°C") nunca es cita ni marchamo. Medido con
 *      la muestra real: esa nota vive en y≈8-45pt desde arriba. OJO:
 *      WTMS usa una zona de "top 40% de la página" (HEADER_ZONE en
 *      pdf.js) — ese umbral NO sirve aquí, porque en Stride el campo
 *      real "Número de marchamos:" de la Parada 1 vive a ~318pt
 *      (≈38% de una página de 842pt) — usar el umbral de WTMS
 *      excluiría por error una corrección legítima. Se usa un umbral
 *      propio, en puntos absolutos, con margen de sobra respecto a
 *      ambos extremos medidos (STRIDE_HEADER_ZONE_MAX_Y).
 *
 *   3) MARCHAMO CORREGIDO A MANO puede aparecer en DOS lugares del
 *      mismo PDF: (a) la propia página de la Parada — atribución
 *      trivial, igual que la cita — o (b) la página resumen final,
 *      pegado al renglón de datos de su Secuencia (mismo criterio de
 *      ancla que ya probó pdf.js para WTMS: el renglón que trae el
 *      marchamo impreso, nunca el de Origen/Destino de abajo). A
 *      diferencia de WTMS, aquí NO hay riesgo de cruce entre rutas
 *      distintas — la tabla resumen de Stride es de UN SOLO viaje
 *      (misma placa en los N renglones), así que "el renglón más
 *      cercano" siempre es inequívoco.
 *      Puede aparecer en AMBOS lugares a la vez, con separador
 *      distinto (espacio vs. salto de línea) — se fusiona con
 *      _mergeAnnotationMarchamos() (reutilizada de pdf.js), que ya es
 *      idempotente: aplicarla dos veces con los mismos valores no
 *      duplica nada, así que el orden de las dos pasadas no importa.
 *
 *   SUPUESTO ABIERTO (confirmar con más PDFs reales antes de confiar
 *   ciegamente en producción): Secuencia de la tabla resumen ==
 *   número de Parada. Cierto en la única muestra real disponible.
 *
 * PENDIENTE (decisión explícita de EduarDo, oct-2026, NO adivinar sin
 * más muestras): Carta Porte ya viene embebido en cada página
 * ("Carta porte:"), lo que sugiere que el cruce con el Reporte WTMS
 * (processors/wtms.js) podría dejar de hacer falta para ese campo —
 * pero processors/wtms.js NO se toca todavía. ID RETORNO tampoco se
 * resuelve aquí por ahora.
 *
 * Este módulo NO se conecta todavía a events.js/merge.js — es
 * deliberado: falta decidir el mapeo final de campos (COL_MAP) y el
 * enrutador WTMS-vs-Stride por contenido del PDF. Sigue el mismo
 * principio de pureza que pdf.js: no importa State ni Supabase, solo
 * recibe un File y un filename, devuelve datos planos.
 */

import {
  MAX_MARCH_SLOTS,
  _isValidMarchamo,
  _extractMarchamoAnnotation,
  _mergeAnnotationMarchamos
} from './pdf.js';

/** Zona de encabezado administrativo de Stride — solo página 1, en
 *  puntos ABSOLUTOS (no proporción de página, a diferencia de WTMS) —
 *  ver nota de cabecera, punto 2. Margen amplio respecto a los ~45pt
 *  medidos en la muestra real, sin acercarse a los ~318pt donde vive
 *  el campo real de marchamos de la Parada 1. */
const STRIDE_HEADER_ZONE_MAX_Y = 90;

/** Detecta el encabezado de una página de parada, ej. "Walmart Parada 3 de 9". */
const PARADA_RE = /Parada\s+(\d+)\s+de\s+(\d+)/i;

/** Detecta la página de tabla resumen final. */
const SUMMARY_HDR_RE = /Informaci[oó]n de la carga/i;

/** Renglón de DATOS de la tabla resumen (placa + secuencia + columnas) —
 *  exige al menos una letra en el primer token para no confundirse con
 *  el renglón "<id origen> <id destino>" (ambos puramente numéricos). */
const SUMMARY_ROW_RE = /^([A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*)\s+(\d+)\b/;

/** Distancia máxima (pt) para atribuir una anotación de la tabla
 *  resumen a un renglón — poco más de un espaciado entre renglones
 *  (~26pt medidos) para no adivinar si cae lejos de cualquier dato. */
const SUMMARY_ROW_MAX_DIST = 40;

function _inStrideHeaderZone(pageNum, y_td) {
  return pageNum === 1 && y_td <= STRIDE_HEADER_ZONE_MAX_Y;
}

/**
 * Lee el PDF con pdfjsLib y devuelve, por página: las líneas de texto
 * agrupadas por posición Y (mismo mecanismo que pdf.js) y las
 * anotaciones FreeText ya clasificadas en citas / correcciones de
 * marchamo / no reconocidas — con las reglas de Stride, no las de
 * WTMS (ver nota de cabecera).
 *
 * NOTA: se duplica aquí el bucle de agrupado de texto de pdf.js
 * (~15 líneas) en vez de reutilizar pdfExtract() de ese archivo,
 * porque pdfExtract() clasifica las anotaciones con las reglas de
 * WTMS (zona de encabezado al 40% de página, ajuste de +1 minuto en
 * la hora de cita) ya mezcladas en el mismo bucle — reutilizarlo tal
 * cual habría requerido desenredar esa lógica de pdf.js, con riesgo
 * real de romper el parser de WTMS en producción durante la
 * migración. Es una duplicación deliberada y acotada; se puede
 * fusionar en un solo helper compartido cuando WTMS se retire.
 *
 * @param {File} file
 * @returns {Promise<{pages: Array<{pageNum:number, pageH:number,
 *   lines: Array<{y:number,text:string}>, citas: Array<{y_td:number,cita:string}>,
 *   marchamoAnnots: Array<{y_td:number,marchamos:string[]}>,
 *   misses: Array<{y_td:number,text:string}>}>}>}
 */
export async function pdfExtractStride(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page  = await pdf.getPage(p);
    const vp    = page.getViewport({ scale: 1 });
    const pageH = vp.height;
    const tc    = await page.getTextContent();
    const byY   = new Map();

    for (const item of tc.items) {
      if (!item.str.trim()) continue;
      const y = Math.round(pageH - item.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(item);
    }

    const lines = [];
    [...byY.keys()].sort((a, b) => a - b).forEach(y => {
      const text = byY.get(y)
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map(i => i.str.trim()).filter(Boolean).join(' ');
      if (text) lines.push({ y, text });
    });

    const citas = [], marchamoAnnots = [], misses = [];
    const rawAnnots = await page.getAnnotations();
    for (const a of rawAnnots) {
      if (a.subtype !== 'FreeText') continue;
      let parts = [];
      if (Array.isArray(a.textContent) && a.textContent.length) {
        parts = a.textContent.map(s => String(s).trim()).filter(Boolean);
      } else {
        const plain = (a.contents || a.alternativeText || '').trim();
        if (plain) parts = [plain];
      }
      const allText = parts.join(' ');
      const y_td = pageH - a.rect[3];

      // Regla 2: zona de encabezado de página 1 — ni cita ni marchamo.
      if (_inStrideHeaderZone(p, y_td)) continue;

      const dateMatch = allText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
      const timeMatch = allText.match(/(\d{1,2})[:.;]\s*(\d{2})(?![\/\-\d])/);
      if (dateMatch) {
        const fecha = dateMatch[1].replace(/-/g, '/');
        // A diferencia de WTMS, NO se aplica el ajuste de "+1 minuto"
        // (ese compensaba un desfase propio del sello de fax de WTMS,
        // sin confirmar que aplique aquí) — se conserva la hora tal
        // cual viene en la anotación.
        const cita = timeMatch
          ? `${fecha} ${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`
          : fecha;
        citas.push({ y_td, cita: cita.trim() });
        continue;
      }

      const marchList = _extractMarchamoAnnotation(allText);
      if (marchList) { marchamoAnnots.push({ y_td, marchamos: marchList }); continue; }

      const trimmed = allText.trim();
      if (trimmed) misses.push({ y_td, text: trimmed });
    }

    pages.push({ pageNum: p, pageH, lines, citas, marchamoAnnots, misses });
  }

  return { pages };
}

/** Busca el valor de una etiqueta "Label: valor" en cualquier línea de la página. */
function _field(lines, re) {
  for (const { text } of lines) {
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  return '';
}

/**
 * Marchamos IMPRESOS de una Parada: viven en la línea siguiente a
 * "Número de marchamos:" — salvo que esa parada no traiga ninguno,
 * en cuyo caso la siguiente línea ya es "Origen - ..." (ver tramo de
 * retorno, Parada final del viaje).
 */
function _parsePrintedMarchamos(lines) {
  const idx = lines.findIndex(l => /N.mero de marchamos:/i.test(l.text));
  if (idx === -1 || idx + 1 >= lines.length) return { marchamos: [], marchamoIssues: [] };
  const next = lines[idx + 1].text.trim();
  if (/^(Origen|Destino)\b/i.test(next)) return { marchamos: [], marchamoIssues: [] };

  const marchamos = [], marchamoIssues = [];
  for (const tok of next.split(/\s+/).filter(Boolean)) {
    if (_isValidMarchamo(tok)) marchamos.push(tok);
    else marchamoIssues.push({ raw: tok });
  }
  return { marchamos, marchamoIssues };
}

/** ID de la ubicación (Origen o Destino) — primer token del renglón de
 *  datos, 2 líneas después del encabezado "Origen - X" / "Destino - X"
 *  (la línea intermedia es siempre "ID de la ubicación Nombre... Dirección"). */
function _parseUbicacionId(lines, labelRe) {
  const idx = lines.findIndex(l => labelRe.test(l.text));
  if (idx === -1 || idx + 2 >= lines.length) return '';
  const dataLine = lines[idx + 2].text.trim();
  return (dataLine.match(/^(\S+)/) || [])[1] || '';
}

/** Extrae todos los campos de una página de Parada ya identificada. */
function _extractStopFields(lines) {
  const factura =
    _field(lines, /N.mero de factura de GLS:\s*(\d+)/i) ||
    _field(lines, /N.mero de control:\s*(\d+)/i);

  const { marchamos, marchamoIssues } = _parsePrintedMarchamos(lines);

  return {
    idViaje:        _field(lines, /ID del viaje:\s*(\S+)/i),
    idCarga:        _field(lines, /ID de la carga:\s*(\S+)/i),
    idMovimiento:   _field(lines, /ID de movimiento:\s*(\S+)/i),
    tipoCarga:      _field(lines, /Tipo de Carga:\s*(\S+)/i),
    factura,
    cartaPorte:     _field(lines, /Carta porte:\s*(\S+)/i),
    idTransportista:_field(lines, /Id del transportista:\s*(\S+)/i),
    placaTractor:   _field(lines, /Placa del Cami.n\/Tractor:\s*(\S+)/i),
    marchamos,
    marchamoIssues,
    origenId:       _parseUbicacionId(lines, /^Origen\s*-/i),
    destinoId:      _parseUbicacionId(lines, /^Destino\s*-/i),
    tarimas:        _field(lines, /N.mero de Etiqueta:\s*([\d.]+)/i),
    peso:           _field(lines, /Peso:\s*([\d.]+)/i),
    volumen:        _field(lines, /Volumen:\s*([\d.]+)/i),
    cajas:          _field(lines, /Cajas:\s*([\d.]+)/i)
  };
}

/** Ancla de cada renglón de datos de la tabla resumen: { secuencia, y }. */
function _buildSummaryRowAnchors(lines) {
  const anchors = [];
  for (const { y, text } of lines) {
    const m = text.match(SUMMARY_ROW_RE);
    if (m) anchors.push({ secuencia: m[2], y });
  }
  return anchors;
}

/** Renglón de anclas más cercano a una anotación, dentro de la distancia máxima permitida. */
function _nearestAnchor(y_td, anchors) {
  let best = null, bestDist = Infinity;
  for (const a of anchors) {
    const d = Math.abs(a.y - y_td);
    if (d < bestDist) { bestDist = d; best = a; }
  }
  return best && bestDist <= SUMMARY_ROW_MAX_DIST ? best : null;
}

/**
 * Parsea el texto/anotaciones ya extraídos ({@link pdfExtractStride})
 * de un PDF de Stride en filas planas, una por entrega (Parada).
 *
 * @param {{pages: Array}} extracted — retorno de pdfExtractStride()
 * @param {string} filename
 * @returns {{rows: Array<object>, unrecognizedAnnotations: Array<{pageNum:number,text:string}>}}
 */
export function parsePDFStride({ pages }, filename) {
  const ruta = filename.replace(/\.pdf$/i, '').replace(/^\d+_/, '');
  const unrecognizedAnnotations = [];

  const stopPages = [];
  let summaryPage = null;
  for (const pg of pages) {
    const pm = pg.lines.map(l => l.text).find(t => PARADA_RE.test(t));
    if (pm) {
      stopPages.push({ pg, paradaNum: pm.match(PARADA_RE)[1] });
    } else if (pg.lines.some(l => SUMMARY_HDR_RE.test(l.text))) {
      summaryPage = pg;
    }
    for (const miss of pg.misses) unrecognizedAnnotations.push({ pageNum: pg.pageNum, text: miss.text });
  }

  // Paso 1: campos + anotaciones propias de CADA página de Parada —
  // atribución trivial, sin matemática de posición (regla 1 y 3-a).
  const rows = stopPages.map(({ pg, paradaNum }) => {
    const fields = _extractStopFields(pg.lines);

    for (const ann of pg.marchamoAnnots) {
      _mergeAnnotationMarchamos(fields.marchamos, ann.marchamos);
    }
    let cita = '';
    if (pg.citas.length) {
      cita = pg.citas[0].cita;
      if (pg.citas.length > 1) {
        unrecognizedAnnotations.push({
          pageNum: pg.pageNum,
          text: `${pg.citas.length} citas en la misma página — se usó la primera (${cita})`
        });
      }
    }

    return { ruta, paradaNum, cita, hrDespacho: '', ...fields };
  });

  // Paso 2: correcciones de marchamo puestas en la tabla resumen
  // (regla 3-b) — match por renglón más cercano, nunca por posición
  // absoluta, y fusión idempotente con lo que ya trae cada fila desde
  // el paso 1 (no duplica si la misma corrección ya se aplicó ahí).
  if (summaryPage) {
    const anchors = _buildSummaryRowAnchors(summaryPage.lines);
    const bySecuencia = new Map(rows.map(r => [r.paradaNum, r]));

    for (const ann of summaryPage.marchamoAnnots) {
      const anchor = _nearestAnchor(ann.y_td, anchors);
      const row = anchor && bySecuencia.get(anchor.secuencia);
      if (row) _mergeAnnotationMarchamos(row.marchamos, ann.marchamos);
      else unrecognizedAnnotations.push({
        pageNum: summaryPage.pageNum,
        text: `Marchamo "${ann.marchamos.join(' ')}" sin renglón cercano en la tabla resumen`
      });
    }
    for (const ann of summaryPage.citas) {
      const anchor = _nearestAnchor(ann.y_td, anchors);
      const row = anchor && bySecuencia.get(anchor.secuencia);
      if (row && !row.cita) row.cita = ann.cita;
    }
  }

  return { rows, unrecognizedAnnotations };
}
