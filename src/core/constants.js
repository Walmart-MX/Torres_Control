/**
 * core/constants.js
 * Constantes globales de la aplicación: límites, nombres de columnas,
 * conjuntos de columnas por origen de dato, alias de detección, y el
 * resolver de columnas (COL_MAP / getMapped).
 *
 * Dependencia especial: COL_MAP['CAPTURA'] necesita State.user para
 * resolver el nombre de quien captura. Por eso este módulo importa
 * State desde state.js. Si state.js alguna vez necesita importar algo
 * de aquí, hay que romper ese ciclo extrayendo COL_MAP a un tercer
 * archivo — por ahora no es necesario.
 */
import { State } from './state.js';

export const MAX_MARCH = 5;

export const COL_RUTA    = 'RUTA';
export const COL_DETTE_E = 'DETTE';
export const COL_DETTE_F = 'DETTE.1';
export const COL_FACT    = 'FACTURAS';

export const SHEET_RUTEO    = ['RUTEO NUEVO', 'RUTEO', 'HOJA1', 'SHEET1'];
export const SHEET_FACTURAS = ['CONCENTRADO FACTURAS', 'FACTURAS', 'CONCENTRADO', 'FACT'];

/** Orden exacto de columnas en el Excel exportado */
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

// Column source sets (para colorear la tabla y el Excel exportado)
export const COLS_PDF  = new Set(['OPERADOR','LIC.','TARIMAS',
  'MARCHAMO 1','MARCHAMO 2','MARCHAMO 3 ','MARCHAMO 4','MARCHAMO 5','FAC.','CITA']);
export const COLS_FILL = new Set(['FECHA','DET','ENTREGA','ENT1','RUTA','CAJAS',
  'CORTINA','TRACTOR ','REMOLQUE','TEMP. ENRAMPE','TEMP. DESENRAMPE',
  'SOLICITUD DE ENRAMPE','ENRAMPE','RETIRO']);
export const COLS_DESP = new Set(['GLS DE EMB.','HORA DE FACTURACION',
  'ID IDA','HR. DESPACHO','SALIDA DE CASETA ','USUARIO WTMS']);

export const PREVIEW_COLS = [
  'FECHA','ENTREGA','ENT1','RUTA','DET','OPERADOR','LIC.',
  'TARIMAS','MARCHAMO 1','FAC.',
  'GLS DE EMB.','HORA DE FACTURACION',
  'ID IDA','HR. DESPACHO','SALIDA DE CASETA ','USUARIO WTMS',
  'CAJAS','CORTINA','TRACTOR ','ENRAMPE','RETIRO','CITA'
];

export const INT_COLS      = new Set(['DET','RUTA','TARIMAS','CAJAS','CORTINA',
  'MARCHAMO 1','MARCHAMO 2','MARCHAMO 3 ','MARCHAMO 4','MARCHAMO 5','FAC.','GLS DE EMB.','SW']);
export const DATE_COLS     = new Set(['FECHA']);
export const DATETIME_COLS = new Set(['HORA DE FACTURACION','HR. DESPACHO',
  'SALIDA DE CASETA ','CITA','SOLICITUD DE ENRAMPE','ENRAMPE','RETIRO']);

/** Alias regex para detectar columnas del panel de pegado de despacho */
export const DESP_ALIASES = {
  ruta:   /^ruta$/i,
  hrDesp: /hr.*desp|hora.*desp|despacho|hr\.?\s*desp/i,
  caseta: /caseta|salida.*caseta|salida/i,
  wtms:   /wtms|usuario/i,
  idIda:  /id.*master|master|id.*ida|id'?s?\s*master/i
};

/**
 * Resolver de columnas — sustituye la cadena de 30 if/else original.
 * Cada función recibe el row del merge y devuelve el valor a mostrar/exportar
 * para esa columna del Excel final.
 */
export const COL_MAP = {
  'FECHA':                r => r['FECHA']       ?? '',
  'SW':                   r => r['_SW']         ?? '',   // ← NUEVO — calendario fiscal Walmart (ver merge.js)
  'ENTREGA':              r => r['SETEO']        ?? '',
  // ... resto sin cambios ...
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
};

/**
 * Devuelve el valor de una columna para un row del merge,
 * usando COL_MAP si existe una regla especial, o el campo directo si no.
 * @param {object} row
 * @param {string} col
 * @returns {*}
 */
export function getMapped(row, col) {
  return (COL_MAP[col] ? COL_MAP[col](row) : row[col]) ?? '';
}
/**
 * Columnas cuyo valor debe preservarse como texto literal — NUNCA como
 * objeto Date. FECHA / TEMP. ENRAMPE / TEMP. DESENRAMPE / SOLICITUD DE
 * ENRAMPE / ENRAMPE / RETIRO vienen de RUTEO NUEVO (ver processors/
 * excel.js). HORA DE FACTURACION viene de la hoja CONCENTRADO FACTURAS
 * (misma función excel.js → processXLS, vía formatFactDate en
 * utils/format.js) y se agrega aquí tras detectar el mismo patrón de
 * bug: aunque el texto se extrajera correctamente, al no estar en esta
 * lista, features/export.js lo reconstruía como Date vía parseDateTime()
 * antes de escribirlo — y SheetJS serializa cualquier Date usando sus
 * componentes UTC, introduciendo el mismo desfase de zona horaria que
 * ya se había corregido para las demás columnas. Usada por
 * processors/excel.js (indirectamente, vía formatFactDate) y
 * features/export.js (para saber qué columnas NO deben pasar por
 * ninguna lógica de Date al exportar).
 */
export const RAW_TEXT_DATE_COLS = new Set([
  'FECHA', 'TEMP. ENRAMPE', 'TEMP. DESENRAMPE', 'SOLICITUD DE ENRAMPE',
  'ENRAMPE', 'RETIRO', 'HORA DE FACTURACION'
]);
