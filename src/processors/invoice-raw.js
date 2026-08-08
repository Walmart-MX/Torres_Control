/**
 * processors/invoice-raw.js
 * Parseo nativo del "Shipment Status Report" (sistema GLS) — facturas
 * crudas de las fuentes SAM'S y AUTO. Fase 1 de la migración de la
 * Macro Despacho (ago-2026): reemplaza la macro VBA `SintesisFacturas`
 * y el paso "Consolidación de Facturas" de `ArbeyJr`.
 *
 * FORMATO DE ENTRADA — verificado contra archivos reales (ver
 * especificación funcional compartida con EduarDo, ago-2026): un
 * archivo .xls legado (OLE2/CDFV2), con ~11 filas de metadatos/
 * criterios de búsqueda antes del encabezado real. El encabezado se
 * localiza DINÁMICAMENTE buscando las columnas DEST #, LOAD #,
 * INVOICE# y FINALIZATION TS — nunca por conteo fijo de filas, a
 * diferencia de la macro original (`Rows("1:11").Delete`), que asumía
 * siempre exactamente 11 filas de metadatos. Esto elimina el límite
 * fijo (confirmado con EduarDo que debe desaparecer, ver ronda 1 de
 * la especificación) sin perder tolerancia si el reporte trae una
 * fila de metadatos de más o de menos en el futuro.
 *
 * De las ~37 columnas del reporte crudo (la mayoría son columnas en
 * blanco/espaciadoras del formato del sistema GLS), solo 4 importan:
 *   DEST #          → dette   (no lo consume hoy processors/excel.js;
 *                      se conserva en el resultado para uso futuro de
 *                      la Fase 3 — consolidación de HUB — sin romper
 *                      el contrato actual de nadie que lea este Map)
 *   LOAD #          → gls     (mismo campo que ya usa merge.js como
 *                      "GLS de embarque")
 *   INVOICE#        → factura — requiere limpieza, ver _cleanInvoice()
 *   FINALIZATION TS → horaFact
 *
 * SALIDA — mismo shape que ya produce processors/excel.js al leer la
 * hoja CONCENTRADO FACTURAS del Excel macro:
 *   Map<factura, { gls, horaFact, dette }>
 * Esto es deliberado: no requiere NINGÚN cambio en merge.js, FactCache,
 * ni en la estrategia de match de facturas (que ya cruza por
 * ruta+factura contra el PDF, nunca contra DETTE). events.js solo
 * fusiona (upsert) este resultado en State.factData, exactamente igual
 * que ya hace con el resultado de processXLS() — mismo patrón,
 * mínimo blast radius.
 *
 * REGLA DE NORMALIZACIÓN DE PREFIJO — confirmada con archivos reales:
 * la fuente SAM'S siempre trae INVOICE# con el prefijo legado "6151"
 * (ej. "06151049812-1"); la fuente AUTO siempre lo trae ya correcto
 * ("04659049810-1"). NO es una heurística de contenido — es una regla
 * fija por fuente, aplicada solo cuando sourceId === 'sams'. Mismo
 * caso de negocio que hoy resuelve `ArbeyJr` con
 * `Replace(..., "6151", "4659")` sobre CONCENTRADO FACTURAS — se
 * preserva aquí en el único lugar donde debe vivir.
 *
 * Dependencias:
 *   - XLSX (SheetJS, cargado globalmente desde el CDN en index.html)
 *   - formatFactDate (utils/format.js) — mismo formateo de fecha/hora
 *     que ya usa processors/excel.js para la columna de finalización
 */
import { formatFactDate } from '../utils/format.js';

/**
 * Alias regex para detectar columnas del reporte crudo, aplicados
 * sobre el encabezado ya recortado (trim) — el reporte real trae
 * encabezados con espacios extra (ej. "LOAD # ", "USER ID ").
 */
export const INVOICE_RAW_ALIASES = {
  dette:    /^dest\s*#$/i,
  gds:      /^load\s*#$/i,
  factura:  /^invoice#$/i,
  finaliza: /^finalization\s*ts$/i
};

/**
 * Limpia el INVOICE# crudo:
 *   1. Descarta el sufijo "-N" (siempre presente en el dato real,
 *      ej. "06151049812-1" → "06151049812").
 *   2. Lo convierte a número — elimina el cero inicial, mismo efecto
 *      que el TextToColumns con formato General de la macro original
 *      (`SintesisFacturas`).
 *   3. Solo para la fuente SAM'S, corrige el prefijo de documento
 *      legado "6151"→"4659" — reemplazo de SUBCADENA (no de valor
 *      completo), igual que el `Range.Replace(..., LookAt:=xlPart)`
 *      de la macro original.
 * @private
 * @param {*} raw — valor crudo de la celda INVOICE#
 * @param {'sams'|'auto'} sourceId
 * @returns {string} — factura limpia, o '' si no se pudo interpretar
 */
function _cleanInvoice(raw, sourceId) {
  const first = String(raw ?? '').split('-')[0].trim();
  if (!first) return '';
  const n = parseInt(first, 10);
  if (isNaN(n)) return '';
  let factura = String(n);
  if (sourceId === 'sams') factura = factura.replace(/6151/g, '4659');
  return factura;
}

/**
 * Localiza la fila de encabezado dentro de las filas crudas del
 * reporte, buscando las 4 columnas indispensables — nunca por conteo
 * fijo de filas (ver nota de cabecera).
 * @private
 * @param {Array<Array<*>>} rows — salida de sheet_to_json(ws, {header:1})
 * @returns {{ headerRowIdx: number, idx: object }|null}
 */
function _findHeader(rows) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const idx = {};
    row.forEach((cell, c) => {
      const h = String(cell ?? '').trim();
      for (const [field, re] of Object.entries(INVOICE_RAW_ALIASES)) {
        if (re.test(h) && idx[field] === undefined) idx[field] = c;
      }
    });
    if (idx.dette !== undefined && idx.gds !== undefined &&
        idx.factura !== undefined && idx.finaliza !== undefined) {
      return { headerRowIdx: r, idx };
    }
  }
  return null;
}

/**
 * Parsea un archivo crudo de facturas (Shipment Status Report, .xls)
 * de la fuente SAM'S o AUTO.
 *
 * Filas sin DEST #/LOAD #/INVOICE# (ej. la fila de "TOTAL" al final
 * del reporte, o cualquier fila de relleno) se descartan de forma
 * natural — mismo criterio que ya usan processWTMS()/processPaste():
 * exigir que los campos clave no estén vacíos, sin necesidad de un
 * caso especial para la fila de totales.
 *
 * @param {File} file
 * @param {'sams'|'auto'} sourceId — determina si se aplica la
 *   corrección de prefijo "6151"→"4659" (ver _cleanInvoice)
 * @returns {Promise<{
 *   data: Map<string, {gls:string, horaFact:string, dette:string}>,
 *   preview: Array<object>,
 *   count: number
 * }>}
 * @throws {Error} si no se pudo localizar el encabezado esperado
 *   (DEST #, LOAD #, INVOICE#, FINALIZATION TS) — señal de que el
 *   archivo no es el reporte esperado o cambió de formato.
 */
export async function processInvoiceRaw(file, sourceId) {
  const buf = await file.arrayBuffer();
  const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws  = wb.Sheets[wb.SheetNames[0]];

  const rows  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const found = _findHeader(rows);
  if (!found) {
    throw new Error(
      'No se detectó el encabezado esperado (DEST #, LOAD #, INVOICE#, ' +
      'FINALIZATION TS) — verifica que el archivo sea un Shipment Status Report exportado del sistema GLS.'
    );
  }
  const { headerRowIdx, idx } = found;

  const data    = new Map();
  const preview = [];

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const dette      = String(row[idx.dette] ?? '').trim();
    const gds        = String(row[idx.gds]   ?? '').trim();
    const facturaRaw = row[idx.factura];
    if (!dette || !gds || !facturaRaw) continue; // fila de totales u otra fila sin datos reales

    const factura = _cleanInvoice(facturaRaw, sourceId);
    if (!factura) continue;

    const horaFact = formatFactDate(row[idx.finaliza]);
    const entry    = { gls: gds, horaFact, dette };
    data.set(factura, entry);
    if (preview.length < 5) preview.push({ factura, ...entry });
  }

  return { data, preview, count: data.size };
}
