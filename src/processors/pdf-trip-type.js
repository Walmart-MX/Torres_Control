/**
 * processors/pdf-trip-type.js
 * Clasificador ligero de PDFs de carga por "Tipo de carga" -- ida vs
 * retorno. Deliberadamente un archivo aparte de pdf.js (que ya pasa
 * las 1300 lineas): esto es un PRE-FILTRO que corre ANTES de decidir
 * si vale la pena correr el parseo completo de pdf.js, no una
 * extension de ese parser. Sin dependencias de State/DOM/otros
 * modulos propios -- igual criterio de pureza que pdf.js.
 *
 * ORIGEN (oct-2026): al agregar seleccion de carpeta completa para los
 * PDFs de cargas (en vez de elegir archivo por archivo), aparecio un
 * problema real -- la carpeta del dia operativo trae MEZCLADOS los
 * PDFs de ida (lo que de verdad hay que procesar) y los de retorno
 * (el viaje vacio de vuelta a CeDis, que no corresponde a ninguna ruta
 * real del Excel del dia). Los nombres de archivo de retorno son
 * inconsistentes a mano (" RET", " RETORNO", " R", " RE", con y sin
 * espacio) -- nada confiable para filtrar por nombre.
 *
 * El campo "Tipo de carga" (segunda pagina del PDF, tabla de
 * encabezado) SI es confiable: se valido contra los 144 PDFs reales de
 * un dia operativo completo (carpeta docs/17-10-2026/, oct-2026) leyendo
 * el campo de los 144 uno por uno -- separacion 100% limpia, CERO casos
 * mezclados:
 *   IDA:     STR (58), DEC (11), DBLSTR (1), DBLDEC (2)
 *   RETORNO: DHD (71), DBLDHD (1)  -- "deadhead", viaje vacio
 *
 * Cualquier valor fuera de estas dos listas se clasifica como
 * 'desconocido' a proposito -- nunca se asume que es ida solo porque
 * no es uno de los retorno conocidos (ver clasificarTipoCarga).
 */

/** Valores de "Tipo de carga" que indican un viaje de IDA real. */
export const IDA_TIPOS = ['STR', 'DEC', 'DBLSTR', 'DBLDEC'];

/** Valores conocidos de "Tipo de carga" que indican retorno (viaje vacio). */
export const RETORNO_TIPOS_CONOCIDOS = ['DHD', 'DBLDHD'];

/**
 * Lee SOLO el campo "Tipo de carga" de la primera pagina de un PDF --
 * deliberadamente mas liviano que pdf.js → pdfExtract() (que agrupa
 * TODAS las lineas por posicion Y y lee anotaciones FreeText de TODAS
 * las paginas): a esto le alcanza con un vistazo rapido a la tabla de
 * encabezado de la pagina 1 para decidir si vale la pena seguir.
 * @param {File} file
 * @returns {Promise<string>} el valor crudo de "Tipo de carga", o '' si no se encontro
 */
export async function detectTipoCarga(file) {
  const buf  = await file.arrayBuffer();
  const pdf  = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const tc   = await page.getTextContent();
  const items = tc.items.map(i => i.str.trim()).filter(Boolean);
  const idx = items.findIndex(s => s === 'Tipo de carga');
  return idx !== -1 ? (items[idx + 1] || '') : '';
}

/**
 * Clasifica un valor de "Tipo de carga" ya leido.
 * @param {string} tipo
 * @returns {'ida'|'retorno'|'desconocido'}
 */
export function clasificarTipoCarga(tipo) {
  if (IDA_TIPOS.includes(tipo)) return 'ida';
  if (RETORNO_TIPOS_CONOCIDOS.includes(tipo)) return 'retorno';
  return 'desconocido';
}
