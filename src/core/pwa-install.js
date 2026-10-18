/**
 * core/pwa-install.js
 * Registro del Service Worker + GATE de instalación obligatoria.
 *
 * Por qué vive aparte de app.js: es una responsabilidad de
 * infraestructura (instalación/offline), no de lógica de despacho —
 * si mañana cambia la estrategia de instalación, se toca un solo
 * archivo chico, no se mete mano en el core.
 *
 * Nota de honestidad técnica, para que quede escrita en el código y
 * nadie prometa de más: esto NO puede bloquear a nivel red que alguien
 * abra la URL en una pestaña normal de navegador — eso no existe en la
 * plataforma web, cualquiera con el link puede entrar. Lo que SÍ hace
 * es detectar si la app corre "standalone" (ya instalada) y, si no,
 * tapar TODA la interfaz con un overlay sin botón de cerrar hasta que
 * instale. `index.html` además NO llama a `init()` (el arranque real
 * de la app, con sus llamadas a Supabase) mientras este gate esté
 * activo, así que tampoco se gasta trabajo de más sirviendo datos a
 * quien solo está viendo la pantalla de instalación.
 *
 * Escape hatch SOLO para el equipo de desarrollo: abrir la app con
 * `?pwa-dev=1` una vez guarda el bypass en localStorage para esa
 * máquina/navegador. No es seguridad, es para no auto-encerrarse
 * mientras se prueba en una pestaña común.
 */

const BYPASS_PARAM = 'pwa-dev';
const BYPASS_KEY = 'sd_pwa_gate_bypass';

let deferredPrompt = null;
let gateEl = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || window.navigator.standalone === true; // Safari legado, inofensivo en Edge
}

function isEdge() {
  return /Edg\//.test(navigator.userAgent);
}

function hasDevBypass() {
  const params = new URLSearchParams(window.location.search);
  if (params.get(BYPASS_PARAM) === '1') {
    localStorage.setItem(BYPASS_KEY, '1');
  }
  return localStorage.getItem(BYPASS_KEY) === '1';
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[SmartDispatch] No se pudo registrar el service worker:', err);
    });
  });
}

function lockBackground() {
  document.documentElement.style.overflow = 'hidden';
  Array.from(document.body.children).forEach((el) => {
    if (el !== gateEl) {
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
    }
  });
}

async function copyLink(feedbackEl) {
  try {
    await navigator.clipboard.writeText(window.location.href);
    feedbackEl.textContent = 'Enlace copiado.';
  } catch {
    feedbackEl.textContent = window.location.href;
  }
}

function escapeAttr(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function renderGateContent() {
  const edge = isEdge();
  const canPrompt = !!deferredPrompt;
  const currentUrl = escapeAttr(window.location.href);

  let message;
  let primaryActionHtml;
  if (edge && canPrompt) {
    message = 'Esta aplicación se usa instalada, no desde una pestaña del navegador. Instalala con un clic:';
    primaryActionHtml = '<button type="button" class="sd-gate-btn sd-gate-btn-primary" id="sd-gate-install">Instalar ahora</button>';
  } else if (edge && !canPrompt) {
    message = 'Esta aplicación se usa instalada, no desde una pestaña del navegador. Instalala desde el menú de Edge: ⋯ → Apps → "Instalar esta página como app".';
    primaryActionHtml = '';
  } else {
    message = 'Por temas de compatibilidad, SmartDispatch solo se instala desde Microsoft Edge. Abrí este mismo enlace en Edge y luego instalala desde ahí (menú ⋯ → Apps → "Instalar esta página como app").';
    primaryActionHtml = `
      <a class="sd-gate-btn sd-gate-btn-primary" id="sd-gate-open-edge" href="microsoft-edge:${currentUrl}">Abrir en Microsoft Edge</a>
      <button type="button" class="sd-gate-btn sd-gate-btn-ghost" id="sd-gate-copy">Copiar enlace</button>`;
  }

  return `
    <div class="sd-gate-card" role="dialog" aria-modal="true" aria-labelledby="sd-gate-title" tabindex="-1">
      <img src="icons/icon-192.png" alt="" class="sd-gate-icon" width="56" height="56">
      <h2 id="sd-gate-title">Instalá SmartDispatch para continuar</h2>
      <p class="sd-gate-msg">${message}</p>
      <div class="sd-gate-actions">${primaryActionHtml}</div>
      <p class="sd-gate-feedback" id="sd-gate-feedback"></p>
    </div>`;
}

function wireGateActions() {
  const installBtn = gateEl.querySelector('#sd-gate-install');
  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') {
      gateEl.querySelector('.sd-gate-msg').textContent =
        '¡Listo! Cerrá esta pestaña y abrí SmartDispatch desde el escritorio o el menú inicio.';
      gateEl.querySelector('.sd-gate-actions').innerHTML = '';
    }
  });

  const copyBtn = gateEl.querySelector('#sd-gate-copy');
  copyBtn?.addEventListener('click', () => {
    copyLink(gateEl.querySelector('#sd-gate-feedback'));
  });
}

function refreshGate() {
  if (!gateEl) return;
  gateEl.innerHTML = renderGateContent();
  wireGateActions();
}

function showGate() {
  if (gateEl) return;
  gateEl = document.createElement('div');
  gateEl.id = 'sd-install-gate';
  gateEl.className = 'sd-install-gate';
  document.body.appendChild(gateEl);
  refreshGate();
  lockBackground();
  requestAnimationFrame(() => gateEl.classList.add('is-visible'));
  gateEl.querySelector('.sd-gate-card')?.focus();
}

/**
 * Arranca el registro del service worker y, si la app no corre
 * instalada, levanta el gate de bloqueo.
 *
 * @returns {boolean} true si el gate está bloqueando el uso de la app
 *   (index.html debe evitar llamar a `init()` en ese caso).
 */
export function initPwaInstall() {
  registerServiceWorker();

  const blocked = !isStandalone() && !hasDevBypass();
  if (!blocked) return false;

  showGate();

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    refreshGate();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });

  return true;
}
