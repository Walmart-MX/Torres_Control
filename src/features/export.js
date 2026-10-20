/**
 * features/export.js
 * Genera y descarga el archivo Excel final del despacho (RUTEO UNIFICADO).
 *
 * Lee State.merged, aplica formatos de celda por tipo de columna y
 * dispara la descarga en el navegador.
 *
 * No muta State. No toca el DOM salvo por el <a download> efímero que
 * arma _triggerDownload() para disparar la descarga (se crea, se hace
 * click, se destruye en el mismo tick).
 *
 * CAMBIO (oct-2026 — motor de escritura: SheetJS → ExcelJS):
 *   El color de encabezado/texto NUNCA llegó a verse en el .xlsx real,
 *   pese a que el código ya construía los objetos de estilo (`ws[addr].s
 *   = {...}`) desde sep-2026. Causa raíz, verificada de forma empírica
 *   (no supuesta — ver tools/verify_export_styles.html, que arma un
 *   libro con ambas librerías y relee el archivo escrito para comparar):
 *   `vendor/xlsx.full.min.js` es el build "Community" (gratuito) de
 *   SheetJS. Ese build sabe LEER fuente/relleno de un Excel, pero al
 *   ESCRIBIR descarta en silencio cualquier `font`/`fill` — sin lanzar
 *   error ni advertencia — porque escribir estilos es una función
 *   exclusiva de SheetJS Pro (licencia de pago). El `{ cellStyles: true }`
 *   que se le pasaba a `XLSX.writeFile()` no tiene ningún efecto sin esa
 *   licencia. Los FORMATOS NUMÉRICOS (fecha, enteros) sí sobrevivían —
 *   ese nunca fue el problema — pero "encabezado navy con texto ámbar/
 *   verde", que es justo lo que pedía la vista previa, es imposible de
 *   lograr con la librería que había.
 *   Se vendoriza `vendor/exceljs.min.js` (ExcelJS, MIT, mismo patrón que
 *   pdf.js/xlsx/supabase-js: un único archivo, sin build step, servido
 *   por el service worker) exclusivamente para la ESCRITURA de este
 *   archivo. SheetJS sigue siendo la librería de LECTURA en el resto de
 *   la app (processors/excel.js, import de catálogos en Administración,
 *   etc.) — no se tocó nada de eso, dos librerías conviven sin conflicto
 *   (nombres de global distintos: `XLSX` vs `ExcelJS`).
 *   La API de ExcelJS es por objetos Row/Cell (no arrays-of-arrays), así
 *   que este archivo se reescribió casi entero; la LÓGICA DE DATOS (qué
 *   columna, qué valor, qué formato para qué tipo) es la misma de antes
 *   — ver _styleCell() como único punto de aplicación de estilo.
 *   La descarga ya no es `XLSX.writeFile()` (eso arma el Blob y dispara
 *   la descarga por dentro) — ExcelJS solo entrega un buffer
 *   (`workbook.xlsx.writeBuffer()`), así que _triggerDownload() arma el
 *   Blob + `<a download>` temporal a mano (patrón estándar para
 *   descargas generadas en el navegador).
 *
 * CAMBIO (oct-2026 — formato de contabilidad para MONTO FACTURA):
 *   La columna ahora lleva el formato numérico "Contabilidad" de Excel
 *   (separador de miles, 2 decimales, símbolo de pesos alineado al
 *   margen izquierdo de la celda y el monto al derecho) — ver
 *   ACCOUNTING_FMT/MONEY_COLS. Antes el valor viajaba como número crudo
 *   sin ningún formato (ej. "33450.5" en vez de "$ 33,450.50"). El valor
 *   subyacente no cambia — sigue siendo un number real, filtrable y
 *   sumable en Excel — solo cambia cómo se despliega.
 *
 * CAMBIO (sep-2026 — formato visual alineado a la vista previa):
 *   El Excel replica el lenguaje visual de la vista previa del
 *   Historial (ui.js → .data-table): encabezado navy, texto monoespaciado
 *   (Consolas), filas alternadas, color SOLO en el texto de RUTA
 *   (ámbar) y de las columnas de datos de PDF (verde).
 *   Todo el estilo vive en THEME/KEY_COLS/DATA_COLS (abajo): ajustar la
 *   apariencia es cambiar esas constantes, no la lógica.
 *   Además: autofiltro, freeze de encabezado, anchos autoajustables y
 *   marchamos con cero inicial conservados como texto.
 *   NO cambia: columnas, orden, valores, ni la lógica de datos.
 *
 * AJUSTES previos que se conservan (jul-2026):
 *   1) FECHA se escribe como TEXTO "DD/MM/YYYY", sin objeto Date
 *      de por medio (ver _buildFechaTexto) — evita desfases de zona
 *      horaria.
 *   2) ID IDA / ID RETORNO / CARTA PORTE — parte de INT_COLS, número real.
 *   3) Columnas de tiempo con datos faltantes — resaltado ámbar.
 *
 * CAMBIO (oct-2026 — banner de secciones): una fila 1 fusionada arriba
 * del encabezado real (que vive en la fila 2) con el nombre de cada
 * sección visual (ver SECTION_BANNERS). Hoy solo existe la sección
 * "FACTURACIÓN" (FAC./MONTO FACTURA/GLS DE EMB., ver BASE_ORDER en
 * core/constants.js) — agregar otra sección es agregar una entrada a
 * SECTION_BANNERS, siempre que sus columnas sean CONTIGUAS en
 * BASE_ORDER (_sectionRanges() ignora silenciosamente cualquier sección
 * que no lo sea, nunca rompe el export).
 *
 * Dependencias:
 *   - State (core/state.js) — lee State.merged únicamente
 *   - BASE_ORDER, INT_COLS, DATE_COLS, DATETIME_COLS, getMapped (core/constants.js)
 *   - TIME_RULES (core/time-engine.js)
 *   - parseDateTime (utils/date.js)
 *   - ExcelJS (vendor/exceljs.min.js, global del navegador, ver index.html)
 */
import { State } from '../core/state.js';
import {
  BASE_ORDER, INT_COLS, DATE_COLS, DATETIME_COLS, getMapped
} from '../core/constants.js';
import { parseDateTime } from '../utils/date.js';
import { TIME_RULES } from '../core/time-engine.js';

// Columnas de salida del motor de tiempos — únicas donde aplica el
// resaltado de "dato faltante".
const TIME_OUTPUT_COLS = new Set(TIME_RULES.map(r => r.out));

/** ExcelJS quiere ARGB (8 hex, alpha primero) — antepone 'FF' (opaco)
 * a los mismos hex de 6 dígitos que ya se usaban con SheetJS. @private */
function _argb(hex) { return 'FF' + hex; }

// ── Tema visual — tokens tomados de la vista previa (index.html) ──
const THEME = {
  font: 'Consolas', size: 9,
  headerBg:   _argb('0B1D33'),   // --navy
  headerText: _argb('E6ECF5'),
  headerKey:  _argb('F5A623'),   // th.h-key (RUTA)
  headerData: _argb('6EE7B7'),   // th.h-pdf
  bodyBg:     _argb('FFFFFF'),
  zebraBg:    _argb('F1F5FB'),   // gris azulado tenue (--surface-2, reforzado para Excel)
  text:       _argb('0B1526'),
  textKey:    _argb('C97C0E'),   // .c-key (RUTA)
  textData:   _argb('1E9E6B'),   // .c-pdf
  border:     _argb('DDE3EC'),
  missingBg:   _argb('FDE68A'), missingText: _argb('92400E')   // resaltado de dato faltante
};

// Columnas con color de énfasis — según lo pedido. FAC./CITA quedan neutras;
// para pintarlas de verde como en la vista previa, agrégalas a DATA_COLS.
const KEY_COLS  = new Set(['RUTA']);
const MARCHAMO_COLS = new Set(['MARCHAMO 1','MARCHAMO 2','MARCHAMO 3 ','MARCHAMO 4','MARCHAMO 5']);
const DATA_COLS = new Set(['OPERADOR','LIC.','TARIMAS', ...MARCHAMO_COLS]);

// Alineación: cantidades a la derecha; fechas/horas/tiempos y códigos cortos centrados; resto izquierda.
const RIGHT_COLS  = new Set(['TARIMAS','CAJAS','CORTINA','MONTO FACTURA']);
const CENTER_COLS = new Set([...DATE_COLS, ...DATETIME_COLS, ...TIME_OUTPUT_COLS, 'DIA','SW','DET']);

// Formato "Contabilidad" nativo de Excel — ver nota de cabecera. Símbolo
// fijo ($) en vez de "moneda del sistema" para que se vea igual sin
// importar la configuración regional de quien abra el archivo.
const ACCOUNTING_FMT = '_-$* #,##0.00_-;-$* #,##0.00_-;_-$* "-"??_-;_-@_-';
const MONEY_COLS = new Set(['MONTO FACTURA']);

// Anchos: autoajuste por contenido, con límites. Override manual por columna si hace falta.
const WIDTH_MIN = 6, WIDTH_MAX = 45, HEADER_PAD = 4, CELL_PAD = 2;
const WIDTH_OVERRIDES = { /* 'OPERADOR': 34 */ };

// ── Banner de secciones (fila fusionada arriba del encabezado real) ──
// Cada entrada pinta un renglón con el label dado, fusionado de punta a
// punta sobre `cols`. `cols` DEBE ser un subconjunto contiguo de
// BASE_ORDER — ver _sectionRanges(), que valida esto y descarta en
// silencio cualquier sección mal formada en vez de romper el export.
const SECTION_BANNERS = [
  { label: 'FACTURACIÓN', cols: ['FAC.', 'MONTO FACTURA', 'GLS DE EMB.'] }
];

/**
 * Resuelve SECTION_BANNERS a rangos de columna [start, end] (índices en
 * BASE_ORDER), validando contigüidad. @private
 * @returns {Array<{label:string, start:number, end:number}>}
 */
function _sectionRanges() {
  const ranges = [];
  for (const section of SECTION_BANNERS) {
    const idxs = section.cols.map(c => BASE_ORDER.indexOf(c));
    if (idxs.some(i => i === -1)) continue; // columna renombrada/eliminada — se omite la sección
    const sorted = [...idxs].sort((a, b) => a - b);
    const isContiguous = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (!isContiguous) continue;
    ranges.push({ label: section.label, start: sorted[0], end: sorted[sorted.length - 1] });
  }
  return ranges;
}

/**
 * Arma el array de la fila 1 (banner) — vacío salvo la celda inicial de
 * cada sección, que lleva el label (las demás celdas del rango se
 * fusionan sobre esa, ver mergeCells() en exportXLSX()). @private
 * @param {Array<{label:string, start:number, end:number}>} sectionRanges
 * @returns {Array<string>}
 */
function _buildBannerRow(sectionRanges) {
  const row = BASE_ORDER.map(() => '');
  for (const s of sectionRanges) row[s.start] = s.label;
  return row;
}

/** Rellena con cero a la izquierda — "6" → "06". @private */
function _pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Construye el texto "DD/MM/YYYY" de la columna FECHA — SIN objeto Date
 * de por medio. Acepta {dd,mm,yyyy}, string, o Date (último respaldo).
 * @private
 */
function _buildFechaTexto(val) {
  if (val && typeof val === 'object' && !(val instanceof Date) && 'dd' in val) {
    return `${_pad2(val.dd)}/${_pad2(val.mm)}/${val.yyyy}`;
  }
  if (typeof val === 'string') return val;
  if (val instanceof Date && !isNaN(val.getTime())) {
    return `${_pad2(val.getDate())}/${_pad2(val.getMonth() + 1)}/${val.getFullYear()}`;
  }
  return String(val ?? '');
}

/** Largo visible aproximado de un valor de celda — para autoajustar anchos. @private */
function _displayLen(v) {
  if (v instanceof Date) return 16; // DD/MM/YYYY HH:MM
  return String(v ?? '').length;
}

/**
 * Aplica fuente/relleno/alineación/borde a una celda — único punto de
 * estilo del archivo (cambiar THEME arriba basta para re-skinear todo).
 * @private
 */
function _styleCell(cell, { bold = false, color = THEME.text, fill = null, align = 'left', size = THEME.size } = {}) {
  cell.font = { name: THEME.font, size, bold, color: { argb: color } };
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.alignment = { horizontal: align, vertical: 'middle' };
  const b = { style: 'thin', color: { argb: THEME.border } };
  cell.border = { bottom: b, right: b };
}

/**
 * Dispara la descarga de un buffer de Excel como archivo. ExcelJS no
 * tiene un writeFile() de navegador como SheetJS — solo entrega el
 * buffer — así que se arma el Blob + <a download> a mano (patrón
 * estándar para descargas generadas en cliente). @private
 */
function _triggerDownload(buffer, filename) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Construye el workbook Excel con una hoja "RUTEO UNIFICADO", aplica el
 * estilo (ver THEME), anchos, freeze, autofiltro y dispara la descarga
 * con nombre ruteo_base_YYYY-MM-DD.xlsx.
 * @returns {Promise<void>} se resuelve cuando la descarga ya se disparó.
 */
export async function exportXLSX(rows, exportType, sessionDate) {
  // Si se pasan filas explícitas (redescarga desde Historial), se usan
  // esas — nunca State.merged de la sesión actual.
  const dataSource = (rows && rows.length) ? rows : State.merged;

  const dataRows = dataSource.map(row => BASE_ORDER.map(col => {
    let val = getMapped(row, col);
    if (val === '' || val === null || val === undefined) return '';
    if (DATE_COLS.has(col)) {
      return _buildFechaTexto(val);
    }
    if (DATETIME_COLS.has(col)) {
      if (val instanceof Date && !isNaN(val.getTime())) return val;
      const d = parseDateTime(String(val));
      return d ? d : val;
    }
    if (INT_COLS.has(col)) {
      const s = String(val).trim();
      // Un marchamo con cero inicial ("012345") se conserva como TEXTO —
      // parseInt lo convertiría en 12345 y perdería el cero.
      if (MARCHAMO_COLS.has(col) && /^0\d+$/.test(s)) return s;
      const n = parseInt(s.replace(/[^\d]/g,''), 10);
      return isNaN(n) ? val : n;
    }
    return val;
  }));

  const sectionRanges = _sectionRanges();
  const bannerRow = _buildBannerRow(sectionRanges);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SmartDispatch';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('RUTEO UNIFICADO', {
    views: [{ state: 'frozen', xSplit: 0, ySplit: 2 }]
  });

  worksheet.addRow(bannerRow);                   // fila 1 — banner de secciones
  worksheet.addRow(BASE_ORDER);                  // fila 2 — encabezado real
  dataRows.forEach(r => worksheet.addRow(r));    // filas 3+ — datos

  // ── Banner de secciones (fila 1) ──
  for (const s of sectionRanges) {
    if (s.end > s.start) worksheet.mergeCells(1, s.start + 1, 1, s.end + 1);
    for (let c = s.start; c <= s.end; c++) {
      _styleCell(worksheet.getCell(1, c + 1), {
        bold: true, color: THEME.headerBg, fill: THEME.headerKey, align: 'center', size: THEME.size + 1
      });
    }
  }

  // ── Encabezado real (fila 2) ──
  BASE_ORDER.forEach((col, c) => {
    const headerColor = KEY_COLS.has(col)  ? THEME.headerKey
                      : DATA_COLS.has(col) ? THEME.headerData
                      : THEME.headerText;
    _styleCell(worksheet.getCell(2, c + 1), {
      bold: true, color: headerColor, fill: THEME.headerBg, align: 'center'
    });
  });

  // ── Datos (fila 3+) ──
  BASE_ORDER.forEach((col, c) => {
    const hAlign = RIGHT_COLS.has(col) ? 'right' : CENTER_COLS.has(col) ? 'center' : 'left';
    const isKey  = KEY_COLS.has(col);
    const isData = DATA_COLS.has(col);

    dataRows.forEach((_, dataIdx) => {
      const R = dataIdx + 3; // fila 1 = banner, fila 2 = encabezado, fila 3 = primer dato
      const cell = worksheet.getCell(R, c + 1);
      const even = dataIdx % 2 === 1;

      _styleCell(cell, {
        bold: isKey,
        color: isKey ? THEME.textKey : isData ? THEME.textData : THEME.text,
        fill: even ? THEME.zebraBg : THEME.bodyBg,
        align: hAlign
      });

      if (DATETIME_COLS.has(col))      cell.numFmt = 'DD/MM/YYYY HH:MM';
      else if (MONEY_COLS.has(col))    cell.numFmt = ACCOUNTING_FMT;
      else if (INT_COLS.has(col))      cell.numFmt = typeof cell.value === 'number' ? '0' : '@';
      else if (col === 'LIC.')         cell.numFmt = '@';   // licencia = texto, Excel no debe reinterpretarla

      const mergedRow     = dataSource[dataIdx];
      const missingReason = TIME_OUTPUT_COLS.has(col) && mergedRow && mergedRow._timeMissing && mergedRow._timeMissing[col];
      if (missingReason) {
        _styleCell(cell, { bold: true, color: THEME.missingText, fill: THEME.missingBg, align: hAlign });
      }
    });
  });

  // ── Anchos autoajustados ──
  BASE_ORDER.forEach((col, c) => {
    let width = WIDTH_OVERRIDES[col];
    if (!width) {
      let max = String(col).trim().length + HEADER_PAD; // margen para el botón del filtro
      for (const r of dataRows) max = Math.max(max, _displayLen(r[c]) + CELL_PAD);
      width = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, max));
    }
    worksheet.getColumn(c + 1).width = width;
  });

  worksheet.getRow(1).height = 22;
  worksheet.getRow(2).height = 20;
  for (let r = 3; r <= dataRows.length + 2; r++) worksheet.getRow(r).height = 15;

  worksheet.autoFilter = {
    from: { row: 2, column: 1 },
    to:   { row: dataRows.length + 2, column: BASE_ORDER.length }
  };

  // sessionDate si se pasó (redescarga de un día pasado); si no, hoy.
  const fecha  = sessionDate || new Date().toISOString().slice(0, 10);
  const buffer = await workbook.xlsx.writeBuffer();
  _triggerDownload(buffer, `ruteo_base_${fecha}.xlsx`);
}
