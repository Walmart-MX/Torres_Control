/**
 * features/auth.js
 * AUTH — identidad de usuario. No toca el DOM; app.js decide qué
 * pintar con cada resultado.
 *
 * CAMBIO (sep-2026 — roles de admin): las funciones sd_admin_* ya NO
 * son de acceso libre — ver docs/fix_admin_roles.sql para el hallazgo
 * completo (PUBLIC tenía EXECUTE, cero verificación de quien llamaba)
 * y el parche de esa fecha.
 *
 * CAMBIO (oct-2026 — spoofing de identidad, cierre del hueco real):
 * el fix de sep-2026 dejaba una grieta: las 4 funciones recibían
 * p_actor_id (un uuid) DESDE EL CLIENTE y solo verificaban "¿este uuid
 * es de un admin?" — nunca que quien llamaba en verdad FUERA ese uuid.
 * Cualquiera con la anon key que consiguiera/adivinara el uuid de un
 * admin (viaja en texto plano en localStorage y en cada request) podía
 * impersonarlo para siempre, sin contraseña. Ver docs/fix_admin_session_tokens.sql.
 *
 * Ahora las 4 funciones exigen p_session_token — un token opaco que
 * Postgres solo emite (sd_admin_login) tras re-validar la contraseña
 * REAL del usuario, expira solo a las 4h y se desliza con cada uso. El
 * flujo en el cliente: la primera acción de admin en una sesión de
 * pestaña dispara un re-prompt de contraseña (ver ensureAdminSession()
 * en app.js) — las siguientes reusan el token ya emitido hasta que
 * expire. adminLogin()/adminLogout()/hasAdminSession() de abajo son la
 * mitad cliente de ese flujo.
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

// Token de sesión de admin — SOLO en memoria (nunca localStorage): vive
// mientras dure la pestaña, se pierde al recargar (el usuario vuelve a
// confirmar su contraseña) y expira solo a las 4h en el servidor.
let _adminSessionToken      = null;
let _adminSessionExpiresAt  = 0;

function _hasAdminSession() {
  return !!_adminSessionToken && Date.now() < _adminSessionExpiresAt;
}

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
    Auth.adminLogout();
    _clear(KNOWN_USER_KEY);
    _clear(SESSION_KEY);
    State.currentUser = null;
  },

  /** Cierra la sesión activa; conserva el usuario recordado (saludo sigue funcionando). */
  logout() {
    Auth.adminLogout();
    _clear(SESSION_KEY);
    State.currentUser = null;
  },

  /** true si hay un token de admin vigente (no expirado) en esta pestaña. */
  hasAdminSession() { return _hasAdminSession(); },

  /**
   * Re-autenticación ("step-up"): confirma la propia contraseña del
   * usuario YA logueado y, si tiene role='admin', emite el token que
   * destraba las 4 funciones sd_admin_*. Ver docs/fix_admin_session_tokens.sql.
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async adminLogin(password) {
    if (!State.currentUser) return { ok: false, error: 'no_session' };
    const { data, error } = await sb.rpc('sd_admin_login', {
      p_username: State.currentUser.username, p_password: password
    });
    if (error) return { ok: false, error: 'network' };
    if (data.ok) {
      _adminSessionToken     = data.token;
      _adminSessionExpiresAt = Date.now() + (data.expiresInMs || 0);
    }
    return data;
  },

  /** Revoca el token de admin en el servidor antes de que expire solo. */
  async adminLogout() {
    if (!_adminSessionToken) return;
    const token = _adminSessionToken;
    _adminSessionToken = null;
    _adminSessionExpiresAt = 0;
    await sb.rpc('sd_admin_logout', { p_session_token: token }).catch(() => {});
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

  // ── Administración (protegida server-side desde sep-2026, identidad
  //    del llamante verificada con token de sesión desde oct-2026 —
  //    ver docs/fix_admin_session_tokens.sql y la nota de cabecera).
  async adminListUsers() {
    if (!_hasAdminSession()) return [];
    const { data, error } = await sb.rpc('sd_admin_list_users', { p_session_token: _adminSessionToken });
    if (error) { console.warn('[Auth] Error listando usuarios:', error.message); return []; }
    return data || [];
  },
  async adminCreateUser(username, password, displayName, captureName) {
    if (!_hasAdminSession()) return { ok: false, error: 'admin_session_required' };
    const { data, error } = await sb.rpc('sd_admin_create_user', {
      p_session_token: _adminSessionToken,
      p_username: username, p_password: password, p_display_name: displayName, p_capture_name: captureName
    });
    return error ? { ok: false, error: error.message } : data;
  },
  async adminSetActive(userId, active) {
    if (!_hasAdminSession()) return { ok: false, error: 'admin_session_required' };
    const { data, error } = await sb.rpc('sd_admin_set_active', {
      p_session_token: _adminSessionToken, p_user_id: userId, p_active: active
    });
    return error ? { ok: false, error: error.message } : data;
  },
  async adminResetPassword(userId, newPassword) {
    if (!_hasAdminSession()) return { ok: false, error: 'admin_session_required' };
    const { data, error } = await sb.rpc('sd_admin_reset_password', {
      p_session_token: _adminSessionToken, p_user_id: userId, p_new_password: newPassword
    });
    return error ? { ok: false, error: error.message } : data;
  }
};
