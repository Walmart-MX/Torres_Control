/**
 * core/constants.js
 * Constantes globales de la aplicación.
 *
 * CAMBIO (integración Reporte WTMS — 4ª fuente obligatoria, jul-2026):
 *   - Se agrega WTMS_ALIASES.
 *   - COL_MAP gana 'ID RETORNO' y 'CARTA PORTE', resueltas siempre
 *     desde nr['_ID_RETORNO']/nr['_CARTA_PORTE'] (armados en merge.js
 *     a partir del cruce con el WTMS). Sobreescritura intencional.
 *   - 'ID RETORNO'/'CARTA PORTE' se agregan a COLS_DESP y PREVIEW_COLS.
 *
 * CAMBIO (rediseño Mesa de Trabajo — mockup jul-2026):
 *   - Se agrega WORKTABLE_COLS: el subconjunto de columnas que muestra
 *     la nueva tabla de Mesa de Trabajo (ui.js → renderTable()), fiel
 *     al set de columnas del mockup (Ruta, Operador, Lic., Tarimas,
 *     Marchamo, Factura, Tienda, Tractor, Remolque — Estado y el botón
 *     de editar se resuelven aparte, no vía getMapped()). PREVIEW_COLS
 *     NO se toca — sigue siendo el set completo usado por
 *     renderHistoryPreview() en el modal de Historial, que conserva su
 *     diseño anterior.
 *
 * AJUSTE (jul-2026 — archivo final): tres cambios solicitados sobre el
 * archivo exportado, sin tocar ningún otro consumidor de estas
 * constantes:
 *   1) COL_MAP['FECHA'] — TERCER intento (ver processors/excel.js para
 *      el detalle completo de por qué los dos anteriores fallaron).
 *      Ahora prioriza r['_FECHA_DMY'] — {dd,mm,yyyy} decodificado del
 *      serial numérico crudo de la celda vía XLSX.SSF.parse_date_code()
 *      — sin ambigüedad de zona horaria ni de orden día/mes. Si la
 *      celda no era numérica, cae a r['_FECHA_TEXT'] (texto formateado,
 *      mejor esfuerzo). Si ninguno existe, cae a r['FECHA'] (el Date
 *      que fiscal-calendar.js/merge.js usan para SW/DIA) como último
 *      respaldo — nunca se queda vacía sin razón.
 *   2) COL_MAP['DIA'] ahora exporta el nombre del día TOTALMENTE EN
 *      MAYÚSCULAS ("LUNES" en vez de "Lunes"). Único punto de lectura
 *      de esta columna — merge.js (DIA_NAMES) no cambia.
 *   3) INT_COLS gana 'ID IDA', 'ID RETORNO' y 'CARTA PORTE': el
 *      exportador (features/export.js) ya sabe convertir cualquier
 *      columna de INT_COLS a número real y aplicarle formato '0' —
 *      agregar estas tres columnas al Set basta para que Excel las
 *      reconozca como número sin necesidad del paso manual
 *      "Convertir a número". No requiere ningún cambio en export.js.
 */
import { State } from './state.js';

export const MAX_MARCH = 5;

export const COL_RUTA    = 'RUTA';
export const COL_DETTE_E = 'DETTE';
export const COL_DETTE_F = 'DETTE.1';
export const COL_FACT    = 'FACTURAS';

export const SHEET_RUTEO    = ['RUTEO NUEVO', 'RUTEO', 'HOJA1', 'SHEET1'];
export const SHEET_FACTURAS = ['CONCENTRADO FACTURAS', 'FACTURAS', 'CONCENTRADO', 'FACT'];

export const BASE_ORDER = [
  'FECHA','DIA','SW','LINEA','ENTREGA','ENT1','RUTA',
  'ID IDA','COSTOS IDA','STATUS IDA','ID RETORNO','COSTO RETORNO','STATUS RETORNO',
  'CARTA PORTE','CAPTURA','USUARIO WTMS','LIC.','OPERADOR','DET','FORMATO','NOMBRE','ESTADO',
  'TARIMAS','MARCHAMO 1','MARCHAMO 2','MARCHAMO 3 ','MARCHAMO 4','MARCHAMO 5',
  'CAJAS','CAP.','CORTINA','TRACTOR ','PLACA TRACTOR',
  'REMOLQUE','PLACA REMOLQUE','GLS DE EMB.','FAC.','ESQUEMA',
  'TEMP. ENRAMPE','TEMP. DESENRAMPE','SOLICITUD DE ENRAMPE','ENRAMPE','TIEMPO ENRAMPE',
  'RETIRO','TIEMP APROX DE CARGA','RETIRO VS DESPACHO','HORA DE FACTURACION',
  'HR. DESPACHO','SALIDA DE CASETA ','TIEMPO DE DESP','TIEMPO EN PATIO','CITA'
];

export const COLS_PDF  = new Set(['OPERADOR','LIC.','TARIMAS',
  'MARCHAMO 1','MARCHAMO 2','MARCHAMO 3 ','MARCHAMO 4','MARCHAMO 5','FAC.','CITA']);
export const COLS_FILL = new Set(['FECHA','DET','ENTREGA','ENT1','RUTA','CAJAS',
  'CORTINA','TRACTOR ','REMOLQUE','TEMP. ENRAMPE','TEMP. DESENRAMPE',
  'SOLICITUD DE ENRAMPE','ENRAMPE','RETIRO']);
export const COLS_DESP = new Set(['GLS DE EMB.','HORA DE FACTURACION',
  'ID IDA','HR. DESPACHO','SALIDA DE CASETA ','USUARIO WTMS','ID RETORNO','CARTA PORTE']);

export const PREVIEW_COLS = [
  'FECHA','ENTREGA','ENT1','RUTA','DET','OPERADOR','LIC.',
  'TARIMAS','MARCHAMO 1','FAC.',
  'GLS DE EMB.','HORA DE FACTURACION',
  'ID IDA','ID RETORNO','CARTA PORTE','HR. DESPACHO','SALIDA DE CASETA ','USUARIO WTMS',
  'CAJAS','CORTINA','TRACTOR ','ENRAMPE','RETIRO','CITA'
];

/**
 * WORKTABLE_COLS — columnas de datos de la nueva tabla "Mesa de Trabajo"
 * (fiel al mockup de rediseño). Deliberadamente un subconjunto reducido
 * de PREVIEW_COLS — el mockup prioriza legibilidad sobre exhaustividad;
 * el detalle completo de una ruta se consulta abriendo el drawer de
 * edición (EditSystem), que ya expone EDITABLE_FIELDS con más campos.
 * 'TIENDA' no tiene entrada en COL_MAP — getMapped() cae a row['TIENDA']
 * directo, que es exactamente donde enrichRow() (Ventana de Recibo) lo
 * escribe. 'ESTADO' de la fila (pill Completa/Advertencia/Crítica/
 * Corregida) NO vive aquí — se deriva aparte en ui.js a partir de
 * State.sveIssues + State.edits, no es una columna de datos mapeable.
 */
export const WORKTABLE_COLS = [
  'RUTA', 'OPERADOR', 'LIC.', 'TARIMAS', 'MARCHAMO 1', 'FAC.', 'TIENDA', 'TRACTOR ', 'REMOLQUE'
];

// AJUSTE (jul-2026 — archivo final): se agregan 'ID IDA', 'ID RETORNO'
// y 'CARTA PORTE' — ver nota de cabecera. El exportador (features/export.js)
// ya convierte cualquier columna listada aquí a número real (parseInt)
// y le aplica formato numérico '0'; no requiere ningún cambio adicional
// ahí, solo esta entrada de configuración.
// core/constants.js
// AJUSTE (ago-2026 — rutas divididas): RUTA se retira de INT_COLS.
// Es un identificador, no una cantidad numérica — forzarlo a entero
// destruía el guión de las rutas divididas ("3215-1" → 32151, ver
// export.js). Nunca se notó antes porque ninguna ruta normal contenía
// caracteres no numéricos. Sin efecto en formato de columna (dejaba
// de aplicarse el formato '0' de Excel a una columna que de todas
// formas es texto).
export const INT_COLS = new Set(['DET','TARIMAS','CAJAS','CORTINA',
  'MARCHAMO 1','MARCHAMO 2','MARCHAMO 3 ','MARCHAMO 4','MARCHAMO 5','FAC.','GLS DE EMB.','SW',
  'ID IDA','ID RETORNO','CARTA PORTE']);
export const DATE_COLS     = new Set(['FECHA']);
export const DATETIME_COLS = new Set(['HORA DE FACTURACION','HR. DESPACHO',
  'SALIDA DE CASETA ','CITA','SOLICITUD DE ENRAMPE','ENRAMPE','RETIRO']);

export const DESP_ALIASES = {
  ruta:   /^ruta$/i,
  hrDesp: /hr.*desp|hora.*desp|despacho|hr\.?\s*desp/i,
  caseta: /caseta|salida.*caseta|salida/i,
  wtms:   /wtms|usuario/i,
  idIda:  /id.*master|master|id.*ida|id'?s?\s*master/i
};

/**
 * Alias regex para detectar columnas del Reporte WTMS (CSV).
 * Se aplican sobre el encabezado ya normalizado con stripAccents()+trim().
 */
export const WTMS_ALIASES = {
  idCarga:        /^id\s*de\s*la\s*carga$/i,
  cartePorte:     /^carte\s*porte$/i,
  siguienteCarga: /^siguiente\s*carga$/i
};

export const COL_MAP = {
  // AJUSTE (jul-2026 — archivo final, TERCER intento): prioriza
  // r['_FECHA_DMY'] — {dd,mm,yyyy} decodificado del serial numérico
  // crudo de la celda (ver processors/excel.js). Respaldos, en orden:
  // r['_FECHA_TEXT'] (texto formateado, si la celda no era numérica) y
  // r['FECHA'] (el Date de SheetJS que fiscal-calendar.js/merge.js
  // usan para SW/DIA) — nunca se queda vacía sin razón.
  'FECHA':                r => r['_FECHA_DMY'] || r['_FECHA_TEXT'] || r['FECHA'] || '',
  // AJUSTE (jul-2026 — archivo final): mayúsculas completas, ver nota
  // de cabecera. Único punto de lectura de esta columna — merge.js
  // (DIA_NAMES) sigue generando "Lunes"/"Martes"/etc. sin cambios.
  'DIA':                  r => String(r['_DIA'] ?? '').trim().toUpperCase(),
  'SW':                   r => r['_SW']         ?? '',
  'ENTREGA':              r => r['SETEO']        ?? '',
  'ENT1':                 r => r['ENT1']         ?? '',
  'RUTA':                 r => r['RUTA']         ?? '',
  'DET':                  r => r['DETTE']        ?? '',
  'CAJAS':                r => r['CAJAS']        ?? '',
  'CORTINA':              r => r['CORTINA']      ?? '',
  'TRACTOR ':             r => r['TRACTOR']      ?? '',
  'REMOLQUE':             r => r['UNIDAD']       ?? '',
  'GLS DE EMB.':          r => r['_GLS']         ?? '',
  'TEMP. ENRAMPE':        r => r['T.E']          ?? '',
  'TEMP. DESENRAMPE':     r => r['T.R']          ?? '',
  'SOLICITUD DE ENRAMPE': r => r['SOLICITUD']    ?? '',
  'ENRAMPE':              r => r['ENRAMPE']      ?? '',
  'RETIRO':               r => r['RETIRO']       ?? '',
  'SALIDA DE CASETA ':    r => r['_CASETA']      ?? '',
  'CAPTURA':              _r => State.user,
  'FAC.':                 r => r['FAC_PDF']      ?? '',
  'LIC.':                 r => r['_LIC']         ?? '',
  'OPERADOR':             r => r['OPERADOR']     ?? '',
  'TARIMAS':              r => r['TARIMAS']      ?? '',
  'MARCHAMO 1':           r => r['MARCHAMO 1']   ?? '',
  'MARCHAMO 2':           r => r['MARCHAMO 2']   ?? '',
  'MARCHAMO 3 ':          r => r['MARCHAMO 3']   ?? '',
  'MARCHAMO 4':           r => r['MARCHAMO 4']   ?? '',
  'MARCHAMO 5':           r => r['MARCHAMO 5']   ?? '',
  'CITA':                 r => r['CITA']         ?? '',
  'ID IDA':               r => r['_ID_IDA']      ?? '',
  'HORA DE FACTURACION':  r => r['_HORA_FACT']   ?? '',
  'HR. DESPACHO':         r => r['_HR_DESP'] || r['_HR_DESP_PDF'] || '',
  'USUARIO WTMS':         r => r['_WTMS']        ?? '',
  'ID RETORNO':           r => r['_ID_RETORNO']  ?? '',
  'CARTA PORTE':          r => r['_CARTA_PORTE'] ?? '',
};

export function getMapped(row, col) {
  return (COL_MAP[col] ? COL_MAP[col](row) : row[col]) ?? '';
}

export const RAW_TEXT_DATE_COLS = new Set([
  'FECHA', 'TEMP. ENRAMPE', 'TEMP. DESENRAMPE', 'SOLICITUD DE ENRAMPE',
  'ENRAMPE', 'RETIRO', 'HORA DE FACTURACION'
]);
