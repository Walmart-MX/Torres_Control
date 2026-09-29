/**
 * features/auth.js
 * AUTH — identidad de usuario. No toca el DOM; app.js decide qué
 * pintar con cada resultado.
 *
 * CAMBIO (sep-2026 — roles de admin): las funciones sd_admin_* ya NO
 * son de acceso libre — ver docs/fix_admin_roles.sql para el hallazgo
 * completo (PUBLIC tenía EXECUTE, cero verificación de quien llamaba)
 * y el parche. Ahora exigen p_actor_id (el id de State.currentUser) y
 * Postgres verifica server-side que ese usuario tenga role='admin' —
 * el prompt() de contraseña del panel de Usuarios en app.js sigue
 * existiendo, pero ya es solo una cortina cosmética; la protección
 * real vive aquí abajo, en las llamadas a los 4 adminXxx().
 *
 * Persistencia en esta terminal (localStorage), dos claves separadas
 * a propósito:
 *   sd_known_user — quién es el usuario "recordado" en esta terminal
 *     (sobrevive a expiración de sesión — es lo que alimenta el saludo
 *     y el formulario de "solo contraseña"). Se borra únicamente con
 *     "Cambiar usuario".
 *   sd_session — ventana de actividad vigente (2h de inactividad,
 *     NO desde el login — ver hasValidSession()). Se borra al expirar
 *     o al cerrar sesión/cambiar usuario.
 *
 * sd_user/sd_configured (localStorage heredado del modelo anterior)
 * quedan sin uso — no se leen ni se escriben desde aquí.
 *
 * Dependencias:
 *   - State (core/state.js) — escribe State.currentUser
 *   - sb (core/supabase-client.js) — RPCs sd_login/sd_change_password/
 *     sd_update_profile/sd_admin_*
 */
import { State } from '../core/state.js';
import { sb } from '../core/supabase-client.js';

const KNOWN_USER_KEY      = 'sd_known_user';
const SESSION_KEY         = 'sd_session';
const SESSION_MS          = 2 * 60 * 60 * 1000; // 2h de inactividad
const ACTIVITY_THROTTLE_MS = 60 * 1000;

let _lastActivityWrite   = 0;
let _expiryCheckInterval = null;
let _onExpire            = null;

function _readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { return null; }
}
function _write(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
function _clear(key)      { localStorage.removeItem(key); }

export const Auth = {
  getKnownUser() { return _readJSON(KNOWN_USER_KEY); },

  /** true si hay un usuario recordado con actividad dentro de las 2h. */
  hasValidSession() {
    const known   = _readJSON(KNOWN_USER_KEY);
    const session = _readJSON(SESSION_KEY);
    if (!known || !session || session.userId !== known.id) return false;
    return (Date.now() - session.lastActivityAt) < SESSION_MS;
  },

  /** Puebla State.currentUser desde localStorage si la sesión sigue vigente. */
  restoreSession() {
    if (!Auth.hasValidSession()) return false;
    const known = _readJSON(KNOWN_USER_KEY);
    State.currentUser = { id: known.id, username: known.username, displayName: known.displayName, captureName: known.captureName };
    return true;
  },

  /** Saludo dinámico por hora local. Siempre a partir de displayName (nunca captureName). */
  greeting() {
    const h = new Date().getHours();
    if (h >= 6  && h < 12) return 'Buen día';
    if (h >= 12 && h < 19) return 'Buenas tardes';
    return 'Buenas noches';
  },

  /**
   * @returns {Promise<{ok:boolean, error?:string, user?:object, isFirstLogin?:boolean}>}
   */
  async login(username, password) {
    const { data, error } = await sb.rpc('sd_login', { p_username: username, p_password: password });
    if (error) return { ok: false, error: 'network' };
    if (!data.ok) return { ok: false, error: data.error };

    const u = { id: data.user.id, username: data.user.username, displayName: data.user.displayName, captureName: data.user.captureName };
    State.currentUser = u;
    _write(KNOWN_USER_KEY, u);
    _write(SESSION_KEY, { userId: u.id, lastActivityAt: Date.now() });
    return { ok: true, user: u, isFirstLogin: !!data.isFirstLogin };
  },

  /** "Cambiar usuario" — borra todo rastro de identidad de esta terminal. */
  changeUser() {
    _clear(KNOWN_USER_KEY);
    _clear(SESSION_KEY);
    State.currentUser = null;
  },

  /** Cierra la sesión activa; conserva el usuario recordado (saludo sigue funcionando). */
  logout() {
    _clear(SESSION_KEY);
    State.currentUser = null;
  },

  /** Refresca la ventana de actividad — llamar desde listeners globales (click/keydown). Throttled. */
  touchActivity() {
    const now = Date.now();
    if (now - _lastActivityWrite < ACTIVITY_THROTTLE_MS) return;
    _lastActivityWrite = now;
    const session = _readJSON(SESSION_KEY);
    if (!session) return;
    _write(SESSION_KEY, { ...session, lastActivityAt: now });
  },

  /** Chequeo periódico (60s) para detectar expiración durante una sesión larga sin reload. */
  startExpiryWatch(onExpire) {
    _onExpire = onExpire;
    if (_expiryCheckInterval) clearInterval(_expiryCheckInterval);
    _expiryCheckInterval = setInterval(() => {
      if (State.currentUser && !Auth.hasValidSession()) {
        State.currentUser = null;
        if (_onExpire) _onExpire();
      }
    }, 60 * 1000);
  },

  async changePassword(currentPassword, newPassword) {
    if (!State.currentUser) return { ok: false, error: 'no_session' };
    const { data, error } = await sb.rpc('sd_change_password', {
      p_user_id: State.currentUser.id, p_current_password: currentPassword, p_new_password: newPassword
    });
    return error ? { ok: false, error: 'network' } : data;
  },

  async updateProfile(currentPassword, displayName, captureName) {
    if (!State.currentUser) return { ok: false, error: 'no_session' };
    const { data, error } = await sb.rpc('sd_update_profile', {
      p_user_id: State.currentUser.id, p_current_password: currentPassword,
      p_display_name: displayName, p_capture_name: captureName
    });
    if (error) return { ok: false, error: 'network' };
    if (data.ok) {
      State.currentUser.displayName = displayName;
      State.currentUser.captureName = captureName;
      const known = _readJSON(KNOWN_USER_KEY);
      if (known) _write(KNOWN_USER_KEY, { ...known, displayName, captureName });
    }
    return data;
  },

  // ── Administración (protegida por rol server-side desde sep-2026 —
  //    ver docs/fix_admin_roles.sql. Antes de eso, las 4 funciones
  //    sd_admin_* no verificaban quién las llamaba: cualquiera con la
  //    anon key —pública, va en el bundle del cliente— podía listar/
  //    crear/resetear/desactivar usuarios sin pasar por el login. El
  //    guard real ahora vive en Postgres (_sd_assert_admin); esto solo
  //    evita una llamada de red inútil si por lo que sea no hay sesión.
  async adminListUsers() {
    if (!State.currentUser) return [];
    const { data, error } = await sb.rpc('sd_admin_list_users', { p_actor_id: State.currentUser.id });
    if (error) { console.warn('[Auth] Error listando usuarios:', error.message); return []; }
    return data || [];
  },
  async adminCreateUser(username, password, displayName, captureName) {
    if (!State.currentUser) return { ok: false, error: 'no_session' };
    const { data, error } = await sb.rpc('sd_admin_create_user', {
      p_actor_id: State.currentUser.id,
      p_username: username, p_password: password, p_display_name: displayName, p_capture_name: captureName
    });
    return error ? { ok: false, error: error.message } : data;
  },
  async adminSetActive(userId, active) {
    if (!State.currentUser) return { ok: false, error: 'no_session' };
    const { data, error } = await sb.rpc('sd_admin_set_active', {
      p_actor_id: State.currentUser.id, p_user_id: userId, p_active: active
    });
    return error ? { ok: false, error: error.message } : data;
  },
  async adminResetPassword(userId, newPassword) {
    if (!State.currentUser) return { ok: false, error: 'no_session' };
    const { data, error } = await sb.rpc('sd_admin_reset_password', {
      p_actor_id: State.currentUser.id, p_user_id: userId, p_new_password: newPassword
    });
    return error ? { ok: false, error: error.message } : data;
  }
};
