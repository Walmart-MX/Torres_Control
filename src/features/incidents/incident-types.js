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
 * CAMBIO (Fase 0 — telemetría de citas no reconocidas, ago-2026):
 *   Se agrega 'cita_unrecognized'. Consumido desde
 *   processors/pdf.js → Events.handlePDFs() (events/events.js): cada
 *   anotación FreeText del PDF cuyo texto NO matcheó el regex de
 *   fecha/hora actual (ver pdf.js → pdfExtract()) se agrupa por FIRMA
 *   DE PATRÓN — no por texto literal, ver _citaPatternSignature() en
 *   pdf.js — para que "CITA: 12/08/2026 06:00" y
 *   "CITA: 13/08/2026 07:30" cuenten como la MISMA incidencia
 *   ("CITA: ##/##/#### ##:##"), no como dos incidencias distintas.
 *   sourceId es siempre el literal 'pdf' (no hay múltiples catálogos
 *   como en catalog_miss); keyName es el literal 'patron_texto';
 *   keyValue es la firma de patrón ya enmascarada.
 *
 *   Objetivo de esta Fase 0: solo VISIBILIDAD — cuántas veces y en qué
 *   rutas aparece cada forma de texto que el detector actual no
 *   reconoce, antes de decidir si construir un catálogo de variantes
 *   completo (ver propuesta-catalogo-variantes-citas.md) o si basta con
 *   ajustar el regex existente. No activa, corrige, ni sustituye nada
 *   de la detección de citas — es puramente informativo.
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
  },

  // NUEVO (Fase 0, ago-2026) — ver nota de cabecera.
  cita_unrecognized: {
    id: 'cita_unrecognized',
    label: 'Patrón de cita no reconocido',
    icon: '🗓️',
    describe({ keyValue }) {
      return `Anotación de cita con un formato que el detector actual no reconoce — patrón: "${keyValue}"`;
    }
  }
};
