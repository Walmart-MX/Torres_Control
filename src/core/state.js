<!-- ── AUTH OVERLAY — login bloqueante, reemplaza el first-run modal anterior ── -->
<div class="modal-overlay hidden" id="authOverlay">
  <div class="modal-box" id="authBox">
    <div class="modal-logo">
      <div class="modal-logo-mark">🚛</div>
      <div class="modal-logo-text"><span>Smart</span>Dispatch · CeDis VHSA</div>
    </div>

    <!-- Terminal conocida — solo contraseña -->
    <form id="authFormKnown" class="auth-view" style="display:none">
      <div class="modal-title" id="authGreeting">—</div>
      <div class="modal-sub">Ingresa tu contraseña para iniciar.</div>
      <div class="modal-field-label">Contraseña</div>
      <input class="modal-input" id="authKnownPassword" type="password" autocomplete="current-password" placeholder="••••••••">
      <div class="auth-error" id="authKnownError"></div>
      <button type="submit" class="modal-btn">Ingresar</button>
      <button type="button" class="auth-link" id="authChangeUser">Cambiar usuario</button>
    </form>

    <!-- Terminal nueva / tras "Cambiar usuario" -->
    <form id="authFormFull" class="auth-view" style="display:none">
      <div class="modal-title">Iniciar sesión</div>
      <div class="modal-sub">Ingresa tu usuario corporativo y tu contraseña de SmartDispatch.</div>
      <div class="modal-field-label">Usuario</div>
      <input class="modal-input" id="authFullUsername" type="text" autocomplete="username" placeholder="Ej. e0g0913">
      <div class="modal-field-label">Contraseña</div>
      <input class="modal-input" id="authFullPassword" type="password" autocomplete="current-password" placeholder="••••••••">
      <div class="auth-error" id="authFullError"></div>
      <button type="submit" class="modal-btn">Ingresar</button>
    </form>

    <!-- Primer login — confirmar perfil -->
    <form id="authFormProfile" class="auth-view" style="display:none">
      <div class="modal-title">Confirma tu perfil</div>
      <div class="modal-sub">Puedes cambiar tu contraseña genérica ahora o más tarde desde Configuración.</div>
      <div class="modal-field-label">Nombre</div>
      <input class="modal-input" id="authProfileDisplay" type="text" maxlength="60" placeholder="Ej. Eduardo García">
      <div class="modal-field-label">Nombre en CAPTURA</div>
      <input class="modal-input" id="authProfileCapture" type="text" maxlength="20" placeholder="Ej. EDUARDO">
      <div class="modal-hint">Así aparecerás en la columna CAPTURA del Excel exportado.</div>
      <div class="modal-field-label">Nueva contraseña (opcional)</div>
      <input class="modal-input" id="authProfileNewPassword" type="password" autocomplete="new-password" placeholder="Dejar en blanco para conservar la actual">
      <div class="auth-error" id="authProfileError"></div>
      <button type="submit" class="modal-btn">Continuar →</button>
    </form>
  </div>
</div>
