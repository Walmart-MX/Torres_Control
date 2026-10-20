/**
 * processors/invoice-report.js
 * REPORTE DE FACTURACIÓN (mainframe "INVOICE DETAIL") — 5ª fuente
 * OBLIGATORIA de SmartDispatch (ver Events.checkSources() en
 * events/events.js, que bloquea el merge completo si falta — mismo
 * criterio que PDF/Excel/despacho/WTMS).
 *
 * CONTEXTO: el CEDIS emite un reporte plano de mainframe ("INVOICE
 * DETAIL", Report id RPinvdtl) con el detalle línea a línea de cada
 * factura del día — uno o varios renglones por INVOICE, cada uno con
 * su TOTAL COST. ORIGEN (aclarado oct-2026): lo manda QA por correo al
 * cierre del día operativo — el archivo descargado queda disponible en
 * la carpeta EMAIL_PROD (ver docs/FUENTES_DE_DATOS.md para el resumen
 * de las 5 fuentes obligatorias). El archivo real que llega a diario NO
 * trae extensión reconocible (se descarga tal cual de ese correo) y
 * puede ser texto plano (.TXT) o el mismo contenido pegado en un .xlsx
 * con columnas ya separadas — este módulo solo atiende el primer caso
 * (texto plano); un .xlsx ya estructurado se procesaría como cualquier
 * otro Excel (fuera de alcance aquí).
 *
 * OBJETIVO: calcular MONTO_FACTURA = SUM(TOTAL COST) agrupado por
 * INVOICE, y exponerlo bajo la MISMA llave que ya usa el resto del
 * cruce de facturas en processors/merge.js (factKey, derivado de
 * pdfRow.factura / CONCENTRADO FACTURAS): el formato confirmado es
 * `DC + folio de 6 dígitos con ceros a la izquierda` (ej. DC 4659,
 * INVOICE 67434 → "4659067434"). El prefijo DC se lee del propio
 * encabezado del reporte ("DC#: 4659 /6151" → se usa el primero).
 *
 * NO se persiste entre días (a diferencia de FactCache) — mismo
 * tratamiento que el Reporte WTMS (processors/wtms.js): catálogo
 * temporal de la corrida actual, se recarga en cada procesamiento y
 * se reinicia en UI.resetAll().
 *
 * FORMATO DEL REPORTE (confirmado con dos archivos de muestra reales):
 *   - Encabezado/pie repetidos cada página (RUN DATE, Report id,
 *     línea de columnas, separadores "---"), se descartan.
 *   - Una línea final " End of report" cierra el archivo — se ignora.
 *   - Renglón de datos (ancho fijo, separado por espacios):
 *       INVOICE  STORE  LOAD  ITEM  "ITEM DESC"  WGT_FMT  CATCH(Y/N)
 *       QUANTITY  UNIT_COST  UNIT_WEIGHT  TOTAL_COST  TOTAL_WEIGHT
 *
 * Dependencias: ninguna.
 */

/** Línea de datos real — ver nota de cabecera para el detalle de columnas. @private */
const DATA_LINE_RE =
  /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.{1,25}?)\s{2,}(\d+)\s+([YN])\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$/;

/** Líneas de encabezado/pie repetidas por página — se descartan sin intentar parsearlas. @private */
const SKIP_PREFIXES = ['RUN DATE', 'Report id', 'INVOICE', 'FORMAT', '-', 'DC#'];

/** Extrae el prefijo de DC del encabezado ("DC#: 4659 /6151" → "4659"). @private */
function _extractDC(raw) {
  const m = raw.match(/DC#:\s*(\d+)/);
  return m ? m[1] : '';
}

/**
 * Parsea el Reporte de Facturación (texto crudo) y agrupa el monto
 * total por factura.
 *
 * @param {string} raw — contenido crudo del archivo
 * @returns {{
 *   invoiceData: Map<string, {monto:number, store:string, load:string}>,
 *   dc: string,
 *   lineCount: number,
 *   skippedCount: number
 * }}
 * @throws {Error} si no se reconoce el formato (cero renglones de
 *   datos) o si no se pudo determinar el DC del encabezado
 */
export function processInvoiceReport(raw) {
  const text = String(raw || '');
  const dc = _extractDC(text);
  if (!dc) {
    throw new Error('No se detectó el DC ("DC#:") en el encabezado del reporte — ¿es el archivo correcto?');
  }

  const lines = text.split(/\r?\n/);
  const totals = new Map(); // invoice crudo → { monto, store, load }
  let skippedCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === 'End of report') continue;
    if (SKIP_PREFIXES.some(p => trimmed.startsWith(p)) || trimmed.includes('Page No')) continue;

    const m = DATA_LINE_RE.exec(line);
    if (!m) { skippedCount++; continue; }

    const [, invoice, store, load, , , , , , , , totalCost] = m;
    const entry = totals.get(invoice) || { monto: 0, store, load };
    entry.monto += parseFloat(totalCost) || 0;
    totals.set(invoice, entry);
  }

  if (!totals.size) {
    throw new Error('El reporte no contiene renglones de factura reconocibles — revisa que sea el formato "INVOICE DETAIL".');
  }

  // Reindexa con la llave que usa el resto del cruce (merge.js): DC + folio de 6 dígitos.
  const invoiceData = new Map();
  totals.forEach((entry, invoice) => {
    const factKey = dc + invoice.padStart(6, '0');
    invoiceData.set(factKey, { monto: Math.round(entry.monto * 100) / 100, store: entry.store, load: entry.load });
  });

  return { invoiceData, dc, lineCount: lines.length, skippedCount };
}
