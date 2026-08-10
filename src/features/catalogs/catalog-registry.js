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
 * CAMBIO (Fase 3 de la migración de la Macro Despacho, ago-2026):
 *   Se agrega la entrada `hubExclusions` — catálogo de determinantes
 *   de HUB que NO representan entregas reales (se usan únicamente
 *   para registrar rutas alternas, confirmado por EduarDo). A
 *   diferencia de Ventana de Recibo/Pool Real, este catálogo NO
 *   alimenta el motor de enrichment (enrichment-rules.js) — lo
 *   consume directamente features/hub-consolidation.js como lista de
 *   exclusión. Se modela con el mismo patrón genérico de todas formas
 *   (misma tabla catalog-store.js, mismo renderer genérico
 *   renderCatalogAdmin() en ui.js) porque es exactamente lo que pidió
 *   EduarDo: "que existan como un catálogo de exclusiones", sin
 *   heurística de ningún tipo — reutiliza el 100% de la infraestructura
 *   ya existente, sin escribir ningún renderer/CRUD nuevo.
 *
 *   SQL para crear la tabla en Supabase (ejecutar una sola vez, mismo
 *   patrón que las tablas de catálogos anteriores — ver nota de
 *   cabecera de features/catalog.js sobre por qué se necesita la
 *   policy de SELECT explícita para el rol anon):
 *
 *     create table catalog_hub_exclusions (
 *       id uuid primary key default gen_random_uuid(),
 *       determinante text not null,
 *       created_at timestamptz default now()
 *     );
 *     alter table catalog_hub_exclusions enable row level security;
 *     create policy "anon select hub_exclusions"
 *       on catalog_hub_exclusions for select using (true);
 *     create policy "anon write hub_exclusions"
 *       on catalog_hub_exclusions for all using (true) with check (true);
 *
 *   Semilla inicial confirmada por EduarDo — agregar manualmente desde
 *   Administración → Exclusiones de HUB una vez creada la tabla, o
 *   vía SQL directo:
 *     insert into catalog_hub_exclusions (determinante) values
 *       ('29999138'), ('29999230');
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
  },
  hubExclusions: {
    id: 'hubExclusions',
    table: 'catalog_hub_exclusions',
    label: 'Exclusiones de HUB',
    indices: ['DETERMINANTE'],
    columns: {
      DETERMINANTE: { db: 'determinante', aliases: /^determinante$/i },
    }
  }
};
