/**
 * features/dispatch-history.js
 * DISPATCH HISTORY — historial permanente de procesamientos, Camino B Fase 3.
 *
 * Cada vez que se exporta un despacho (limpio, con advertencias confirmadas,
 * o forzado con errores críticos), se crea un registro definitivo en
 * Supabase: una fila en `dispatch_sessions` (metadatos del procesamiento)
 * más una fila en `dispatch_rows` por cada registro de State.merged
 * (guardado como JSONB completo, no columnas SQL individuales).
 *
 * DECISIÓN DE DISEÑO — por qué JSONB y no columnas:
 *   El objetivo explícito de esta fase es que el mismo dataset persistido
 *   sirva para múltiples formatos de exportación futuros (Despacho hoy,
 *   Monitoreo después) sin migrar el esquema cada vez que cambie una
 *   columna. Cada exportador (ver features/export.js) decide qué columnas
 *   mostrar y cómo, leyendo del mismo `data` JSONB — la persistencia no
 *   conoce ni le importa el formato de salida.
 *
 * DECISIÓN DE DISEÑO — una sesión por exportación, no por día:
 *   Si el mismo día operativo se reprocesa y exporta varias veces, cada
 *   exportación queda como un registro distinto e inmutable — auditoría
 *   completa de "quién exportó qué y cuándo", nunca se sobreescribe nada.
 *   getTodaySession() siempre devuelve la más reciente completada del día.
 *
 * Este módulo es puro (no toca el DOM) — la orquestación de qué hacer
 * con el resultado (mostrar el banner, refrescar el modal de historial)
 * vive en Events, igual que catalog.js y fact-cache.js.
 *
 * Dependencias:
 *   - State (core/state.js) — lee State.user, State.sveLastQuality
 *   - sb (core/supabase-client.js) — cliente Supabase compartido
 */
import { State } from '../core/state.js';
import { sb } from '../core/supabase-client.js';

const SESSIONS_TABLE = 'dispatch_sessions';
const ROWS_TABLE     = 'dispatch_rows';

export const DispatchHistory = {

  /**
   * Persiste un procesamiento completo: crea la sesión, inserta todas
   * las filas, y marca la sesión como 'completed'. Si falla a mitad de
   * camino, la sesión queda marcada 'error' (visible en el historial)
   * en vez de desaparecer silenciosamente.
   *
   * @param {Array<object>} rows — típicamente State.merged
   * @param {object} meta — metadatos libres (tipo de exportación, acción
   *   de auditoría, conteos SVE, etc.) — se guarda tal cual en meta (jsonb)
   * @returns {Promise<string>} el id de la sesión creada
   * @throws {Error} si la sesión o las filas no se pudieron guardar
   */
  async finalizeSession(rows, meta = {}) {
    if (!rows || !rows.length) throw new Error('No hay registros para guardar');

    const today = new Date().toISOString().slice(0, 10);
    const user  = State.user || null;

    const { data: sessionRow, error: sessionError } = await sb.from(SESSIONS_TABLE)
      .insert({
        session_date: today,
        status:       'processing',
        created_by:   user,
        row_count:    rows.length,
        match_count:  rows.filter(r => r._matched).length,
        lic_count:    rows.filter(r => r._LIC).length,
        desp_count:   rows.filter(r => r._despMatched).length,
        quality:      State.sveLastQuality,
        meta
      })
      .select()
      .single();

    if (sessionError) throw new Error('No se pudo crear la sesión: ' + sessionError.message);

    const sessionId = sessionRow.id;
    const rowsPayload = rows.map((r, idx) => ({
      session_id: sessionId, row_index: idx, row_key: r._rowId || null, data: r
    }));

    const { error: rowsError } = await sb.from(ROWS_TABLE).insert(rowsPayload);

    if (rowsError) {
      // No dejamos la sesión en 'processing' colgada — se marca 'error'
      // para que el historial la muestre como fallida, no como fantasma.
      await sb.from(SESSIONS_TABLE)
        .update({ status: 'error', finished_at: new Date().toISOString() })
        .eq('id', sessionId);
      throw new Error('No se pudieron guardar los registros: ' + rowsError.message);
    }

    await sb.from(SESSIONS_TABLE)
      .update({ status: 'completed', finished_at: new Date().toISOString(), finished_by: user })
      .eq('id', sessionId);

    return sessionId;
  },

  /**
   * Devuelve la sesión completada más reciente del día operativo de hoy,
   * o null si aún no se ha procesado nada hoy. Usado para el aviso
   * "El día operativo de hoy ya fue procesado".
   * @returns {Promise<object|null>}
   */
  async getTodaySession() {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await sb.from(SESSIONS_TABLE)
      .select('*')
      .eq('session_date', today)
      .eq('status', 'completed')
      .order('finished_at', { ascending: false })
      .limit(1);

    if (error || !data || !data.length) return null;
    return data[0];
  },

  /**
   * Lista las sesiones más recientes (cualquier estado) para el panel
   * "Historial de Procesamientos". No trae las filas — solo metadatos,
   * para que la lista cargue rápido incluso con cientos de sesiones.
   * @param {number} limit
   * @returns {Promise<Array<object>>}
   */
  async listSessions(limit = 50) {
    const { data, error } = await sb.from(SESSIONS_TABLE)
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.warn('[DispatchHistory] Error listando sesiones:', error.message);
      return [];
    }
    return data;
  },

  /**
   * Reconstruye el dataset completo de una sesión (para vista previa o
   * re-descarga). Devuelve los rows en el mismo shape que tenían en
   * State.merged al momento de exportar.
   * @param {string} sessionId
   * @returns {Promise<Array<object>>}
   */
  async getSessionRows(sessionId) {
    const { data, error } = await sb.from(ROWS_TABLE)
      .select('row_index, data')
      .eq('session_id', sessionId)
      .order('row_index', { ascending: true });

    if (error) {
      console.warn('[DispatchHistory] Error leyendo filas de la sesión:', error.message);
      return [];
    }
    return data.map(r => r.data);
  }
};
