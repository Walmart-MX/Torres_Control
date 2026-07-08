/**
 * processors/pdf.js
 * Extracción y parseo de los PDFs de cargas (formato Walmart CeDis).
 *
 * Dos funciones encadenadas:
 *   pdfExtract(file) → lee el PDF con pdf.js, devuelve líneas de texto
 *                       agrupadas por posición Y, y anotaciones FreeText/Text
 *                       (citas).
 *   parsePDF(extracted, filename) → interpreta esas líneas con regex
 *                       específicas del formato del documento, devuelve
 *                       un array de rows { ruta, operador, destino, factura,
 *                       tarimas, marchamos, cita, hrDespacho }.
 *
 * FIX (auditoría post-Camino B):
 *   1. hrDespacho: el sello "Impreso / enviado por fax" lo imprime el
 *      sistema de Walmart en formato MM/DD/YYYY (convención de EEUU); el
 *      resto de la app usa DD/MM/YYYY. Antes se reensamblaban los grupos
 *      capturados sin invertir día/mes — ahora se invierten, con una
 *      validación defensiva (si el primer grupo no puede ser un mes
 *      válido, se asume que ya viene en DD/MM/YYYY y no se toca).
 *   2. parsePDF(): el regex que detecta "PDF unificado de dos rutas"
 *      (ej. "12345-67890.pdf") también matcheaba nombres de ruta partida
 *      como "4102-2.pdf", interpretándolos erróneamente como dos rutas
 *      separadas ("4102" y "2") en vez de una sola ruta ("4102-2"). Se
 *      agrega una heurística: si el segundo grupo tiene notablemente
 *      menos dígitos que el primero, se trata como sufijo de ruta partida
 *      (una sola ruta), no como PDF unificado. Caso límite documentado:
 *      si algún día existe un PDF unificado real donde la segunda ruta
 *      tiene menos dígitos que la primera, esta heurística lo clasificaría
 *      mal — no se ha observado ese caso en los datos actuales.
 *   3. pdfExtract(): los regex de fecha/hora de las citas (anotaciones)
 *      eran demasiado rígidos (exigían exactamente 2 dígitos de día/mes y
 *      4 de año, separador de hora limitado a : . ;). Se amplían para
 *      aceptar 1-2 dígitos de día/mes, año de 2 o 4 dígitos, y espacio
 *      como separador de hora — superconjunto estricto de lo anterior,
 *      no se pierden matches previos. También se aceptan anotaciones
 *      subtype 'Text' además de 'FreeText'.
 *
 * Dependencia externa: pdfjsLib (cargado globalmente desde el CDN en
 * index.html, con su workerSrc ya configurado ahí). Este módulo no
 * configura el worker — eso es responsabilidad del bootstrap en index.html.
 *
 * Sin dependencias de State, DOM, ni otros módulos propios — son
 * funciones puras de transformación de datos.
 */

/**
 * Extrae todas las líneas de texto (agrupadas por posición vertical)
 * y las anotaciones de tipo FreeText/Text (citas de cada destino) de un PDF.
 *
 * @param {File} file
 * @returns {Promise<{ lines: Array<{pageNum:number,y:number,text:string}>,
 *                      annots: Array<{pageNum:number,y_td:number,cita:string}> }>}
 */
export async function pdfExtract(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [], annots = [];

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

    [...byY.keys()].sort((a, b) => a - b).forEach(y => {
      const text = byY.get(y)
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map(i => i.str.trim()).filter(Boolean).join(' ');
      if (text) lines.push({ pageNum: p, y, text });
    });

    const rawAnnots = await page.getAnnotations();
    for (const a of rawAnnots) {
      // FIX #7: además de 'FreeText', algunos PDFs codifican la cita
      // como anotación 'Text' (nota adhesiva) — se amplía sin cambiar
      // el resto de la lógica de extracción de texto.
      if (a.subtype !== 'FreeText' && a.subtype !== 'Text') continue;
      let parts = [];
      if (Array.isArray(a.textContent) && a.textContent.length) {
        parts = a.textContent.map(s => String(s).trim()).filter(Boolean);
      } else {
        const plain = (a.contents || a.alternativeText || '').trim();
        if (plain) parts = [plain];
      }
      const allText = parts.join(' ');

      // FIX #7: 1-2 dígitos de día/mes, año de 2 o 4 dígitos — superconjunto
      // estricto del regex anterior (\d{2}/\d{2}/\d{4}), sigue matcheando
      // todo lo que matcheaba antes, más formatos con dígitos sin padding
      // o año corto.
      const dateMatch = allText.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      // FIX #7: se agrega espacio como separador válido de hora, además
      // de : . ; — cubre extracciones de texto donde el separador se
      // pierde y queda como espacio simple.
      const timeMatch = allText.match(/(\d{1,2})[:.;\s]\s*(\d{2})(?![\/\-\d])/);
      if (!dateMatch) continue;

      let [, dd, mm, yy] = dateMatch;
      dd = dd.padStart(2, '0');
      mm = mm.padStart(2, '0');
      if (yy.length === 2) yy = '20' + yy;
      const fecha = `${dd}/${mm}/${yy}`;

      let cita = fecha;
      if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        let m = parseInt(timeMatch[2], 10);
        m += 1;
        if (m >= 60) { m = 0; h += 1; }
        if (h >= 24) h = 0;
        cita = fecha + ' ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      }
      annots.push({ pageNum: p, y_td: pageH - a.rect[3], cita: cita.trim() });
    }
  }
  return { lines, annots };
}

/**
 * Interpreta las líneas extraídas por pdfExtract() según el formato
 * específico de los PDFs de carga de Walmart CeDis, y produce un array
 * de rows estructurados — uno por cada destino/factura encontrado.
 *
 * Maneja tres casos de nombre de archivo:
 *   - "12345.pdf"        → ruta única
 *   - "4102-2.pdf"        → ruta partida — sufijo con menos dígitos que
 *                            la ruta principal, se trata como UNA sola ruta
 *   - "12345-67890.pdf"  → PDF unificado de dos rutas (ambos grupos con
 *                            magnitud de dígitos similar) — se reparten
 *                            los destinos entre ambas
 *
 * @param {{ lines: Array, annots: Array }} extracted — salida de pdfExtract()
 * @param {string} filename — nombre original del archivo (para detectar ruta(s))
 * @returns {Array<{ ruta, operador, destino, factura, tarimas, marchamos, cita, hrDespacho }>}
 */
export function parsePDF({ lines, annots }, filename) {
  const baseName     = filename.replace(/\.pdf$/i, '').replace(/^\d+_/, '');
  const unifiedMatch = baseName.match(/^(\d+)-(\d+)$/);
  // FIX #6: distingue "PDF unificado real" (dos rutas de magnitud similar,
  // ej. "12345-67890") de "ruta partida" (ej. "4102-2", donde "2" es un
  // sufijo de sub-ruta, no una segunda ruta completa). Heurística: si el
  // segundo grupo tiene menos dígitos que el primero, es un sufijo de
  // ruta partida — se trata baseName completo como una sola ruta.
  const isSplitSuffix = !!unifiedMatch && unifiedMatch[2].length < unifiedMatch[1].length;
  const isUnified      = !!unifiedMatch && !isSplitSuffix;
  const rutas           = isUnified ? [unifiedMatch[1], unifiedMatch[2]] : [baseName];

  let nombre = '', apellido = '', hrDespacho = '';
  for (const { text } of lines) {
    const nm = text.match(/^Nombre del Operador\s+(.+)$/i);   if (nm) nombre   = nm[1].trim();
    const am = text.match(/^Apellido del Operador\s+(.+)$/i); if (am) apellido = am[1].trim();
    if (!hrDespacho) {
      const fm = text.match(/Impreso\s*\/\s*enviado\s+por\s+fax\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4})\s+(\d{2}:\d{2})/i);
      if (fm) {
        let rawDate = fm[1].replace(/-/g, '/');
        const pts = rawDate.split('/');
        if (pts[2] && pts[2].length === 2) pts[2] = '20' + pts[2];
        // FIX #4: el sello lo imprime Walmart en MM/DD/YYYY — se
        // intercambian día y mes para que quede en DD/MM/YYYY, la
        // convención del resto de la app. Guard defensivo: si el primer
        // grupo no puede ser un mes válido (>12), se asume que el PDF ya
        // viene en DD/MM/YYYY y no se invierte.
        const mmVal = parseInt(pts[0], 10);
        const swapped = (mmVal >= 1 && mmVal <= 12) ? `${pts[1]}/${pts[0]}/${pts[2]}` : pts.join('/');
        hrDespacho = swapped + ' ' + fm[2];
      }
    }
  }
  const operador = (nombre + ' ' + apellido).trim();

  const ROW_RE  = /^CeDis\s+(?:TIENDA|HUB)\s+\S+\s+\d+\s+(4659\d{6})\s+(\d+)\s+\d+\s+\d+\s+\d+\s+[\d.]+\s+(\d{5,6})$/;
  const CONT_RE = /^4659\s+(\w+)(?:\s+(\d{5,6}))?$/;
  const MARC_RE = /^0?\d{5,6}$/;
  const STOP_RE = /^(Total de ordenes|Fin del informe|Walmart)/i;
  const DEST_RE = /^(?:TIENDA|HUB)\s+(\d+)\s+-\s+Zona horaria/i;

  const destPositions = [];
  for (const { pageNum, y, text } of lines) {
    const dm = text.match(DEST_RE);
    if (dm) destPositions.push({ destino: dm[1], pageNum, y });
  }

  const rawRows = [];
  const textLines = lines.map(l => l.text);
  let i = 0;
  while (i < textLines.length) {
    const rm = textLines[i].match(ROW_RE);
    if (rm) {
      const factura = rm[1], tarimas = rm[2], marchamos = [rm[3]];
      let destino = ''; i++;
      if (i < textLines.length) {
        const cm = textLines[i].match(CONT_RE);
        if (cm) { destino = cm[1]; if (cm[2]) marchamos.push(cm[2]); i++; }
      }
      while (i < textLines.length) {
        const tl = textLines[i].trim();
        if (STOP_RE.test(tl)) break;
        if (tl.match(MARC_RE)) { marchamos.push(tl); i++; } else break;
      }
      rawRows.push({ factura, tarimas, marchamos, destino });
    } else i++;
  }

  let result = [];
  if (isUnified) {
    const destinos    = [...new Set(rawRows.map(r => r.destino).filter(Boolean))];
    const sameDestino = destinos.length <= 1;
    if (sameDestino) {
      const mid = Math.ceil(rawRows.length / 2);
      const grupos = [rawRows.slice(0, mid), rawRows.slice(mid)];
      rutas.forEach((ruta, idx) => {
        const grupo = grupos[idx] || [];
        if (!grupo.length) return;
        const marchamos = [...new Set(grupo.flatMap(r => r.marchamos))];
        const tarimas   = String(grupo.reduce((s, r) => s + (parseInt(r.tarimas, 10) || 0), 0));
        result.push({ ruta, operador, destino: grupo[0].destino, factura: grupo[0].factura, tarimas, marchamos, cita: '', hrDespacho });
      });
    } else {
      for (const r of rawRows) {
        result.push({ ruta: baseName, operador, destino: r.destino, factura: r.factura, tarimas: r.tarimas, marchamos: r.marchamos, cita: '', hrDespacho });
      }
    }
  } else {
    for (const r of rawRows) {
      result.push({ ruta: rutas[0], operador, destino: r.destino, factura: r.factura, tarimas: r.tarimas, marchamos: r.marchamos, cita: '', hrDespacho });
    }
  }

  if (annots.length && destPositions.length) {
    for (const ann of annots) {
      let candidates = destPositions.filter(d => d.pageNum === ann.pageNum && d.y <= ann.y_td + 300);
      if (!candidates.length) candidates = destPositions.filter(d => d.pageNum === ann.pageNum);
      if (!candidates.length) candidates = destPositions.filter(d => d.pageNum === ann.pageNum - 1);
      if (!candidates.length) candidates = destPositions;
      if (!candidates.length) continue;
      const best = candidates.reduce((a, b) => Math.abs(a.y - ann.y_td) < Math.abs(b.y - ann.y_td) ? a : b);
      const citaRows = result.filter(r => r.destino === best.destino && !r.cita);
      for (const row of citaRows) row.cita = ann.cita;
    }
  }
  return result;
}
