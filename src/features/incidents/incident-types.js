/**
 * features/incidents/incident-types.js
 * INCIDENT TYPES — registro de tipos de incidencia administrativa que
 * alimenta el Centro de Mantenimiento. Mismo patrón que
 * catalog-registry.js (features/catalogs/): agregar un tipo de
 * incidencia nuevo en el futuro (ej. "cruce WTMS fallido recurrente",
 * "licencia de operador inconsistente") = una entrada nueva aquí —
 * incident-engine.js e incident-store.js son genéricos y no cambian.
 *
 * Cada tipo define:
 *   id       — clave interna (columna `type` en admin_incidents)
 *   label    — nombre visible en el Centro de Mantenimiento
 *   icon     — emoji para la UI
 *   describe(incident) — texto legible dado { sourceId, keyName, keyValue }
 *
 * Sin dependencias de otros módulos propios.
 */
export const INCIDENT_TYPES = {
  catalog_miss: {
    id: 'catalog_miss',
    label: 'Registro faltante en catálogo',
    icon: '📇',
    describe({ sourceId, keyName, keyValue }) {
      const catalogLabel =
        sourceId === 'ventanaRecibo' ? 'Ventana de Recibo' :
        sourceId === 'poolReal'      ? 'Pool Real' : sourceId;
      return `${catalogLabel}: ${keyName} "${keyValue}" no encontrado.`;
    }
  }
};
