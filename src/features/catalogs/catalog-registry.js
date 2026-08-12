/**
 * features/catalogs/catalog-registry.js
 * CATALOG REGISTRY — tabla de configuración de catálogos maestros.
 *
 * Agregar un catálogo nuevo en el futuro = una entrada nueva aquí +
 * su tabla en Supabase + sus reglas en enrichment-rules.js. Ningún
 * otro módulo (catalog-store.js, enrichment-engine.js) se modifica.
 *
 * Cada entrada define:
 *   id       — clave interna (usada en State.catalogs, ENRICHMENT_RULES)
 *   table    — tabla de Supabase
 *   label    — nombre visible
 *   indices  — qué columnas del catálogo sirven como llave de búsqueda
 *              (Ventana de Recibo tiene 1, Pool Real tiene 2 — ECO y
 *              REMOLQUE sobre la misma tabla)
 *   columns  — mapa columna-canónica → { db: nombre en Supabase,
 *              aliases: regex para detectarla al importar un Excel }
 *
 * Sin dependencias de otros módulos propios.
 */
export const CATALOGS = {
  ventanaRecibo: {
    id: 'ventanaRecibo',
    table: 'catalog_ventana_recibo',
    label: 'Ventana de Recibo',
    indices: ['DETTE'],
    columns: {
      DETTE:   { db: 'dette',   aliases: /^dette$/i },
      FORMATO: { db: 'formato', aliases: /^formato$/i },
      TIENDA:  { db: 'tienda',  aliases: /^tienda$/i },
      ESTADO:  { db: 'estado',  aliases: /^estado$/i },
    }
  },
  poolReal: {
    id: 'poolReal',
    table: 'catalog_pool_real',
    label: 'Pool Real',
    indices: ['ECO', 'REMOLQUE'],
    columns: {
      ECO:        { db: 'eco',       aliases: /^eco$/i },
      'PLACAS T': { db: 'placas_t',  aliases: /placas?\s*t\b/i },
      LINEA:      { db: 'linea',     aliases: /^linea$/i },
      FLOTA:      { db: 'flota',     aliases: /^flota$/i },
      REMOLQUE:   { db: 'remolque',  aliases: /^remolque$/i },
      'PLACAS R': { db: 'placas_r',  aliases: /placas?\s*r\b/i },
      CAPACIDAD:  { db: 'capacidad', aliases: /^capacidad$/i },
    }
  }
};
