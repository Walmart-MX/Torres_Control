/**
 * features/catalogs/enrichment-rules.js
 * ENRICHMENT RULES — qué campo de State.merged cruza con qué catálogo/
 * índice, y qué columnas del archivo final llena con el resultado.
 *
 * sourceCol: campo del row CRUDO de RUTEO NUEVO (antes de mapear a
 *   columnas del export) — mismo objeto que llega a runMerge() como
 *   `row`, no `nr`.
 * mapping: { columnaDestinoEnElExportFinal: columnaOrigenEnElCatalogo }
 *
 * CONFIRMADO con EduarDo (jul-2026): la columna REMOLQUE del Pool Real
 * cruza contra row['UNIDAD'] — el mismo campo que hoy arma la columna
 * REMOLQUE del export (ver COL_MAP['REMOLQUE'] en core/constants.js),
 * NO contra una columna llamada literalmente "REMOLQUE" en RUTEO NUEVO.
 *
 * Agregar una regla nueva = una entrada más en este array —
 * enrichment-engine.js no cambia.
 */
export const ENRICHMENT_RULES = [
  {
    catalog: 'ventanaRecibo', index: 'DETTE', sourceCol: 'DETTE',
    mapping: { FORMATO: 'FORMATO', TIENDA: 'TIENDA', ESTADO: 'ESTADO' }
  },
  {
    catalog: 'poolReal', index: 'ECO', sourceCol: 'TRACTOR',
    mapping: { LINEA: 'LINEA', 'PLACA TRACTOR': 'PLACAS T', ESQUEMA: 'FLOTA' }
  },
  {
    catalog: 'poolReal', index: 'REMOLQUE', sourceCol: 'UNIDAD',
    mapping: { 'PLACA REMOLQUE': 'PLACAS R', 'CAP.': 'CAPACIDAD' }
  },
];
