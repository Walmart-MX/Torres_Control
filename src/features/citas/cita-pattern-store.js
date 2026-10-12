/**
 * features/citas/cita-pattern-store.js
 * CITA PATTERN STORE — persistencia de variantes de cita en Supabase
 * (tabla cita_patterns, ver docs/cita_patterns_table.sql). Mismo
 * patrón que features/catalogs/catalog-store.js: State es la caché de
 * lectura en memoria, Supabase es la fuente de verdad.
 *
 * DIFERENCIA respecto a los catálogos maestros: no hay importación
 * masiva por Excel — cada variante se agrega/quita individualmente
 * desde Administración → Centro de Mantenimiento → "Variantes de
 * Cita" (ver ui/cita-pattern-ui.js + events.js). "Quitar" es borrado
 * lógico (active=false), nunca físico — conserva el rastro de qué
 * formatos se intentaron, mismo criterio que admin_incidents.status.
 *
 * Dependencias:
 *   - State (core/state.js) — escribe State.citaPatterns
 *   - sb (core/supabase-client.js)
 */
import { State } from '../../core/state.js';
import { sb } from '../../core/supabase-client.js';

const TABLE = 'cita_patterns';

export const CitaPatternStore = {
  /**
   * Carga todas las variantes ACTIVAS desde Supabase hacia
   * State.citaPatterns. Se llama al iniciar la app (ver core/app.js,
   * junto a CatalogStore.loadAll()) y cada vez que se abre el panel de
   * administración correspondiente, para reflejar cambios de otras
   * sesiones.
   * @returns {Promise<void>}
   */
  async loadAll() {
    const { data, error } = await sb.from(TABLE)
      .select('*').eq('active', true).order('created_at', { ascending: true });
    if (error) {
      console.warn('[CitaPatternStore] Error cargando variantes de cita:', error.message);
      State.citaPatterns = [];
      return;
    }
    State.citaPatterns = data || [];
  },

  /**
   * Agrega una variante nueva. Aplica a partir del siguiente PDF que
   * se procese — no reprocesa nada retroactivamente.
   * @param {object} values — { label, date_order, date_sep, year_digits,
   *   allow_single_digit, has_time, time_sep, example_text }
   * @param {string} user — State.user, para auditoría
   * @returns {Promise<object>} la fila insertada
   * @throws {Error} si falla Supabase
   */
  async addPattern(values, user) {
    const row = {
      label:              (values.label || '').trim() || null,
      date_order:         values.date_order || 'DMY',
      date_sep:           values.date_sep || '/',
      year_digits:        Number(values.year_digits) === 2 ? 2 : 4,
      allow_single_digit: !!values.allow_single_digit,
      has_time:           !!values.has_time,
      time_sep:           values.has_time ? (values.time_sep || ':') : null,
      example_text:       (values.example_text || '').trim() || null,
      created_by:         user || null,
    };
    const { data, error } = await sb.from(TABLE).insert(row).select().single();
    if (error) throw new Error('No se pudo guardar la variante: ' + error.message);
    State.citaPatterns = [...State.citaPatterns, data];
    return data;
  },

  /**
   * Quita (desactiva) una variante — borrado lógico, ver nota de
   * cabecera.
   * @param {string} id
   * @returns {Promise<void>}
   * @throws {Error} si falla Supabase
   */
  async deletePattern(id) {
    const { error } = await sb.from(TABLE).update({ active: false }).eq('id', id);
    if (error) throw new Error('No se pudo quitar la variante: ' + error.message);
    State.citaPatterns = State.citaPatterns.filter(p => p.id !== id);
  }
};
