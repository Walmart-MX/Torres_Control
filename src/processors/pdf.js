/**
 * processors/pdf.js
 * Extracción y parseo de los PDFs de cargas (formato Walmart CeDis).
 *
 * Dos funciones encadenadas:
 *   pdfExtract(file) → lee el PDF con pdf.js, devuelve líneas de texto
 *                       agrupadas por posición Y, y anotaciones FreeText (citas).
 *   parsePDF(extracted, filename) → interpreta esas líneas con regex
 *                       específicas del formato del documento, devuelve
 *                       un array de rows { ruta, operador, destino, factura,
 *                       tarimas, marchamos, marchamoIssues, cita, hrDespacho }.
 *
 * FIX DE INTEGRIDAD DE DATOS — extracción tolerante por campo (jul-2026):
 *   Antes, ROW_RE capturaba factura + tarimas + marchamo de encabezado
 *   en UN SOLO regex atómico con el marchamo forzado a `\d{5,6}`. Si el
 *   marchamo llegaba con formato inválido (ej. "3732226", 7 dígitos),
 *   el regex COMPLETO fallaba — se perdían también factura y tarimas,
 *   que sí eran válidos y pertenecían legítimamente a esa entrega.
 *   Esa era la validación "todo o nada" real: no estaba en merge.js
 *   (que decide si usar un bloque ya extraído), sino aquí, en cómo se
 *   reconocía la posición de cada campo dentro del bloque.
 *
 *   Ahora la extracción y la validación del marchamo están desacopladas:
 *     - ROW_RE / CONT_RE reconocen la posición del marchamo con un
 *       patrón amplio (\S+) — así factura, tarimas y destino se separan
 *       correctamente SIEMPRE, sin importar si el marchamo es válido.
 *     - Cada marchamo candidato (encabezado + continuaciones) se valida
 *       de forma independiente contra el formato estricto (_isValidMarchamo).
 *     - Si es válido → se conserva en `marchamos[i]`.
 *     - Si no → esa posición queda '' (nunca se inventa ni se reutiliza
 *       un valor de otra entrega) y se registra en `marchamoIssues`
 *       (valor crudo descartado, para diagnóstico) — ver
 *       features/validation/sve.js, regla 'bad_march'.
 *   Ningún campo inválido invalida ni afecta a los demás campos del
 *   mismo bloque — principio de "máxima recuperación de información
 *   confiable, mínima intervención manual".
 *
 * FIX (jul-2026) — HR. DESPACHO con fecha invertida:
 *   El sello "Impreso/enviado por fax" del PDF imprime la fecha en
 *   formato inglés MM-DD-YYYY (confirmado con muestra real:
 *   "07-26-2026 01:28:46 CT" = 26 de julio de 2026), pero el código
 *   anterior tomaba los tres números tal cual y los unía sin
 *   reordenar, asumiendo que ya venían como DD/MM/YYYY. Resultado: se
 *   guardaba "07/26/2026" (mes=07, "día"=26) y parseDateTime()/
 *   normalizeAppointment() (utils/date.js), que SIEMPRE interpretan el
 *   primer número como día y el segundo como mes, terminaban armando
 *   new Date(2026, 25, 7, ...) — mes 26 desborda en JavaScript y
 *   "rueda" el año hacia adelante (de ahí el salto a 2028 observado en
 *   producción). Se invierten aquí mismo pts[0]/pts[1] al capturar la
 *   fecha del sello, para dejarla en DD/MM/YYYY, formato que espera el
 *   resto de la app — ningún otro módulo (date.js, merge.js,
 *   constants.js) cambia.
 *
 * Dependencia externa: pdfjsLib (cargado globalmente desde el CDN en
 * index.html, con su workerSrc ya configurado ahí). Este módulo no
 * configura el worker — eso es responsabilidad del bootstrap en index.html.
 *
 * Sin dependencias de State, DOM, ni otros módulos propios — son
 * funciones puras de transformación de datos. MAX_MARCH_SLOTS se
 * duplica localmente (mismo valor que MAX_MARCH en core/constants.js)
 * en vez de importarlo, para preservar esa independencia — pdf.js no
 * debe depender de ningún otro módulo propio.
 */

/** Máximo de marchamos por entrega — debe coincidir con MAX_MARCH (core/constants.js). */
const MAX_MARCH_SLOTS = 5;

/** Formato válido de marchamo: 5-6 dígitos, con o sin cero inicial. */
const MARC_RE = /^0?\d{5,6}$/;

/** Detección "candidata" de continuación de marchamo — más laxa que
 *  MARC_RE a propósito: solo sirve para decidir si una línea DEBE
 *  tratarse como un intento de marchamo (y por lo tanto seguir
 *  consumiéndola dentro del bloque de esta entrega) o no. La validez
 *  real del contenido se decide aparte con _isValidMarchamo(). */
const MARC_CANDIDATE_RE = /^\d{3,10}$/;

/** Valida el formato final de un marchamo ya extraído. @private */
function _isValidMarchamo(s) {
  return MARC_RE.test(String(s || '').trim());
}

/**
 * Extrae todas las líneas de texto (agrupadas por posición vertical)
 * y las anotaciones de tipo FreeText (citas de cada destino) de un PDF.
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
      if (a.subtype !== 'FreeText') continue;
      let parts = [];
      if (Array.isArray(a.textContent) && a.textContent.length) {
        parts = a.textContent.map(s => String(s).trim()).filter(Boolean);
      } else {
        const plain = (a.contents || a.alternativeText || '').trim();
        if (plain) parts = [plain];
      }
      const allText   = parts.join(' ');
      const dateMatch = allText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
      const timeMatch = allText.match(/(\d{1,2})[:.;]\s*(\d{2})(?![\/\-\d])/);
      if (!dateMatch) continue;
      const fecha = dateMatch[1].replace(/-/g, '/');
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
 * Agrega un marchamo candidato a los arreglos de salida, validando su
 * formato de forma independiente al resto del bloque. Nunca lanza,
 * nunca reutiliza un valor de otra posición — si es inválido, deja la
 * posición vacía y registra el detalle crudo en `issues`.
 * @private
 * @param {string} raw — texto crudo capturado en esa posición
 * @param {string[]} marchamos — arreglo de salida (mutado in-place)
 * @param {Array<{raw:string}>} issues — arreglo de incidencias (mutado in-place)
 */
function _pushMarchamo(raw, marchamos, issues) {
  const val = String(raw || '').trim();
  if (!val) return; // posición no capturada — no es un "campo inválido", simplemente no había nada ahí
  if (_isValidMarchamo(val)) {
    marchamos.push(val);
  } else {
    marchamos.push('');
    issues.push({ raw: val });
  }
}

/**
 * Interpreta las líneas extraídas por pdfExtract() según el formato
 * específico de los PDFs de carga de Walmart CeDis, y produce un array
 * de rows estructurados — uno por cada destino/factura encontrado.
 *
 * Maneja dos casos de nombre de archivo:
 *   - "12345.pdf"        → ruta única
 *   - "12345-67890.pdf"  → PDF unificado de dos rutas (se reparten
 *                            los destinos entre ambas)
 *
 * @param {{ lines: Array, annots: Array }} extracted — salida de pdfExtract()
 * @param {string} filename — nombre original del archivo (para detectar ruta(s))
 * @returns {Array<{ ruta, operador, destino, factura, tarimas, marchamos,
 *                    marchamoIssues, cita, hrDespacho }>}
 *          marchamoIssues: Array<{raw:string}> — marchamos candidatos
 *          detectados en el PDF que NO pasaron la validación de formato
 *          y por lo tanto quedaron vacíos en `marchamos` — consumido por
 *          features/validation/sve.js (regla 'bad_march') para reportar
 *          la incidencia con el valor crudo, sin bloquear ni afectar el
 *          resto de los campos de la misma entrega.
 */
export function parsePDF({ lines, annots }, filename) {
  const baseName     = filename.replace(/\.pdf$/i, '').replace(/^\d+_/, '');
  const unifiedMatch = baseName.match(/^(\d+)-(\d+)$/);
  const isUnified    = !!unifiedMatch;
  const rutas        = isUnified ? [unifiedMatch[1], unifiedMatch[2]] : [baseName];

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
        // FIX: el sello del PDF viene en formato inglés MM/DD/YYYY
        // (confirmado con muestra real: "07-26-2026" = 26 de julio de
        // 2026) — se invierte aquí a DD/MM/YYYY, que es la convención
        // que usa el resto de la app (normalizeAppointment/parseDateTime
        // en utils/date.js). NO tocar sin volver a verificar el formato
        // real del sello si cambia el proveedor/plantilla del PDF.
        hrDespacho = `${pts[1]}/${pts[0]}/${pts[2]} ${fm[2]}`;
      }
    }
  }
  const operador = (nombre + ' ' + apellido).trim();

  // Los grupos de factura/tarimas se validan por su propia forma
  // (4659xxxxxx / dígitos) — independientes entre sí. El grupo del
  // marchamo de encabezado ahora es \S+ (cualquier token no vacío):
  // reconoce la POSICIÓN del campo sin exigirle el formato todavía —
  // la validación de formato se hace aparte en _pushMarchamo(). Así,
  // un marchamo con longitud incorrecta ya NO impide capturar factura
  // y tarimas, que son campos independientes y válidos.
  const ROW_RE  = /^CeDis\s+(?:TIENDA|HUB)\s+\S+\s+\d+\s+(4659\d{6})\s+(\d+)\s+\d+\s+\d+\s+\d+\s+[\d.]+\s+(\S+)$/;
  // Mismo criterio para el marchamo de continuación (grupo 2, opcional):
  // \S+ en vez de \d{5,6} — el destino (grupo 1) siempre se captura
  // aunque el marchamo que lo acompañe sea inválido.
  const CONT_RE = /^4659\s+(\w+)(?:\s+(\S+))?$/;
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
      const factura = rm[1], tarimas = rm[2];
      const marchamos = [], marchamoIssues = [];

      // Marchamo de encabezado — validado de forma independiente,
      // nunca invalida factura/tarimas ya capturados arriba.
      _pushMarchamo(rm[3], marchamos, marchamoIssues);

      let destino = ''; i++;
      if (i < textLines.length) {
        const cm = textLines[i].match(CONT_RE);
        if (cm) {
          destino = cm[1];
          if (cm[2]) _pushMarchamo(cm[2], marchamos, marchamoIssues);
          i++;
        }
      }
      // Líneas de continuación con marchamos adicionales. Se usa un
      // detector "candidato" amplio (MARC_CANDIDATE_RE) para decidir
      // si la línea pertenece a este bloque de marchamos — la validez
      // real de cada una se decide aparte en _pushMarchamo(), así que
      // una línea con formato inválido NO corta la recolección de las
      // siguientes líneas válidas que vengan después.
      while (i < textLines.length && marchamos.length + marchamoIssues.length < MAX_MARCH_SLOTS) {
        const tl = textLines[i].trim();
        if (STOP_RE.test(tl)) break;
        if (MARC_CANDIDATE_RE.test(tl)) { _pushMarchamo(tl, marchamos, marchamoIssues); i++; }
        else break;
      }
      rawRows.push({ factura, tarimas, marchamos, marchamoIssues, destino });
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
        const marchamos      = [...new Set(grupo.flatMap(r => r.marchamos))];
        const marchamoIssues = grupo.flatMap(r => r.marchamoIssues || []);
        const tarimas   = String(grupo.reduce((s, r) => s + (parseInt(r.tarimas, 10) || 0), 0));
        result.push({ ruta, operador, destino: grupo[0].destino, factura: grupo[0].factura, tarimas, marchamos, marchamoIssues, cita: '', hrDespacho });
      });
    } else {
      for (const r of rawRows) {
        result.push({ ruta: baseName, operador, destino: r.destino, factura: r.factura, tarimas: r.tarimas, marchamos: r.marchamos, marchamoIssues: r.marchamoIssues || [], cita: '', hrDespacho });
      }
    }
  } else {
    for (const r of rawRows) {
      result.push({ ruta: rutas[0], operador, destino: r.destino, factura: r.factura, tarimas: r.tarimas, marchamos: r.marchamos, marchamoIssues: r.marchamoIssues || [], cita: '', hrDespacho });
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
