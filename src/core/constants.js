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

export const INT_COLS      = new Set(['DET','RUTA','TARIMAS','CAJAS','CORTINA',
  'MARCHAMO 1','MARCHAMO 2','MARCHAMO 3 ','MARCHAMO 4','MARCHAMO 5','FAC.','GLS DE EMB.','SW']);
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
  'FECHA':                r => r['FECHA']       ?? '',
  'DIA':                  r => r['_DIA']        ?? '',
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
