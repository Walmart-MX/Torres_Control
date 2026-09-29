/**
 * features/incidents/inline-fix.js
 * INLINE FIX — captura rápida desde el Centro de Mantenimiento para
 * resolver una incidencia de "registro faltante en catálogo" sin salir
 * del panel: se escriben los datos junto al valor faltante, se guarda,
 * y el registro nace en el catálogo maestro correspondiente.
 *
 * REEMPLAZA a features/incidents/pool-plate-fix.js (ese archivo puede
 * eliminarse — esta versión es su generalización).
 *
 * TABLA DE CONFIGURACIÓN — INLINE_FIX[sourceId][keyName]:
 *   sourceId — catálogo (mismo id que CATALOGS en catalog-registry.js)
 *   keyName  — índice que no se encontró (ECO, REMOLQUE, DETTE)
 *   fields   — columnas del catálogo que se capturan en esa fila:
 *     col         columna canónica (mismo nombre que CATALOGS[..].columns)
 *     label       nombre corto para mensajes de error
 *     placeholder texto del input (el "*" lo agrega ui.js si es required)
 *     required    true = sin este dato NO se guarda ni se cierra la incidencia
 *     width       ancho del input en px
 *     upper       true = se normaliza a MAYÚSCULAS (placas)
 *
 * Reglas confirmadas con EduarDo (sep-2026):
 *   - Pool Real ECO (tractor):  PLACAS T obligatoria; LINEA y FLOTA opcionales.
 *   - Pool Real REMOLQUE:       PLACAS R obligatoria; CAPACIDAD opcional.
 *   - Ventana de Recibo DETTE:  FORMATO, TIENDA y ESTADO, los tres obligatorios.
 *
 * Agregar otro caso en el futuro = una entrada más en INLINE_FIX —
 * events.js/ui.js/app.js no cambian.
 *
 * Dependencias:
 *   - State (core/state.js) — lee State.catalogs para evitar duplicados
 *   - CatalogStore (features/catalogs/catalog-store.js) — addRow()
 *   - IncidentStore (features/incidents/incident-store.js) — resolveManually()
 */
import { State } from '../../core/state.js';
import { CatalogStore } from '../catalogs/catalog-store.js';
import { IncidentStore } from './incident-store.js';

export const INLINE_FIX = {
  poolReal: {
    ECO: { fields: [
      { col: 'PLACAS T', label: 'Placa tractor', placeholder: 'Placa tractor', required: true,  width: 112, upper: true },
      { col: 'LINEA',    label: 'Línea',         placeholder: 'Línea',         required: false, width: 84 },
      { col: 'FLOTA',    label: 'Flota',         placeholder: 'Flota',         required: false, width: 84 },
    ]},
    REMOLQUE: { fields: [
      { col: 'PLACAS R',  label: 'Placa remolque', placeholder: 'Placa remolque', required: true,  width: 112, upper: true },
      { col: 'CAPACIDAD', label: 'Capacidad',      placeholder: 'Capacidad',      required: false, width: 92 },
    ]},
  },
  ventanaRecibo: {
    DETTE: { fields: [
      { col: 'FORMATO', label: 'Formato', placeholder: 'Formato', required: true, width: 88 },
      { col: 'TIENDA',  label: 'Tienda',  placeholder: 'Tienda',  required: true, width: 88 },
      { col: 'ESTADO',  label: 'Estado',  placeholder: 'Estado',  required: true, width: 88 },
    ]},
  },
};

/**
 * @param {{source_id:string, key_name:string}} incident
 * @returns {{fields:Array<object>}|null} null si la incidencia no admite captura inline
 */
export function getInlineFix(incident) {
  return INLINE_FIX[incident.source_id]?.[incident.key_name] || null;
}

/** Recorta y colapsa espacios; a mayúsculas solo si el campo lo pide (placas). @private */
function _norm(field, raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return field.upper ? s.toUpperCase() : s;
}

/**
 * Valida, agrega el registro al catálogo maestro y resuelve la incidencia.
 *
 * @param {object} incident — fila de admin_incidents (con id, source_id, key_name, key_value)
 * @param {Object<string,string>} rawValues — { columnaCanonica: textoCapturado }
 * @param {string} user — State.user, para auditoría
 * @returns {Promise<void>}
 * @throws {Error} si no aplica, falta un campo obligatorio, el valor ya
 *   existe en el catálogo, o falla Supabase
 */
export async function saveInlineFix(incident, rawValues, user) {
  const cfg = getInlineFix(incident);
  if (!cfg) throw new Error('Esta incidencia no admite captura rápida.');

  const values  = {};
  const missing = [];
  cfg.fields.forEach(f => {
    const v = _norm(f, rawValues && rawValues[f.col]);
    if (v) values[f.col] = v;
    else if (f.required) missing.push(f.label);
  });
  if (missing.length) throw new Error(`Falta capturar: ${missing.join(', ')}.`);

  // Guarda contra duplicados — si el valor ya existe en el catálogo
  // cargado, agregar otra fila dispararía la regla cat_dup. La incidencia
  // probablemente quedó vieja (el catálogo se actualizó después del
  // último merge); se pide editar el registro existente en Administración.
  const exists = (State.catalogs[incident.source_id] || [])
    .some(r => String(r[incident.key_name] || '').trim() === String(incident.key_value || '').trim());
  if (exists) {
    throw new Error(`${incident.key_name} "${incident.key_value}" ya existe en el catálogo — edítalo en Administración.`);
  }

  await CatalogStore.addRow(
    incident.source_id,
    { [incident.key_name]: incident.key_value, ...values },
    user
  );
  await IncidentStore.resolveManually(
    incident.id, user,
    `Registro capturado desde Centro de Mantenimiento (${Object.values(values).join(' · ')})`
  );
}
