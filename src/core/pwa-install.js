/**
 * core/pwa-install.js
 * Registro del Service Worker + banner de instalación como PWA.
 *
 * Por qué vive aparte de app.js: es una responsabilidad de
 * infraestructura (instalación/offline), no de lógica de despacho —
 * si mañana cambia la estrategia de instalación, se toca un solo
 * archivo chico, no se mete mano en el core.
 *
 * Nota de honestidad técnica, para que quede escrita en el código y
 * nadie prometa de más: esto NO puede bloquear que alguien abra la URL
 * en una pestaña normal de navegador — eso no existe en la plataforma
 * web. Lo que SÍ hace es detectar si la app corre "standalone" (ya
 * instalada) y, si no, insistir con un banner claro hasta que el
 * usuario instale o lo posponga.
 */

const DISMISS_KEY = 'sd_install_nag_dismissed_until';
const DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h antes de volver a insistir
const AUTO_SHOW_DELAY_MS = 4000; // margen para no competir con el login/carga inicial

let deferredPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || window.navigator.standalone === true; // Safari legado, inofensivo en Edge
}

function isDismissedForNow() {
  const until = Number(localStorage.getItem(DISMISS_KEY) || 0);
  return Date.now() < until;
}

function dismissForNow() {
  localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_COOLDOWN_MS));
  hideBanner();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[SmartDispatch] No se pudo registrar el service worker:', err);
    });
  });
}

function showManualInstructions(banner) {
  const copy = banner.querySelector('.sd-install-copy span');
  if (copy) {
    copy.textContent = 'En Edge: menú (⋯) → Apps → "Instalar esta página como app".';
  }
}

function buildBanner() {
  const banner = document.createElement('div');
  banner.id = 'sd-install-banner';
  banner.className = 'sd-install-banner';
  banner.innerHTML = `
    <div class="sd-install-card">
      <img src="icons/icon-192.png" alt="" class="sd-install-icon" width="40" height="40">
      <div class="sd-install-copy">
        <strong>Instalá SmartDispatch</strong>
        <span>Abrila como app de escritorio en Edge: arranca más rápido y sin pestañas de más.</span>
      </div>
      <div class="sd-install-actions">
        <button type="button" class="sd-install-btn sd-install-btn-primary" id="sd-install-btn">Instalar</button>
        <button type="button" class="sd-install-btn sd-install-btn-ghost" id="sd-install-dismiss">Ahora no</button>
      </div>
    </div>`;
  document.body.appendChild(banner);

  banner.querySelector('#sd-install-dismiss').addEventListener('click', dismissForNow);
  banner.querySelector('#sd-install-btn').addEventListener('click', async () => {
    if (!deferredPrompt) {
      showManualInstructions(banner);
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') hideBanner();
  });

  return banner;
}

function showBanner() {
  if (isStandalone() || isDismissedForNow()) return;
  const banner = document.getElementById('sd-install-banner') || buildBanner();
  requestAnimationFrame(() => banner.classList.add('is-visible'));
}

function hideBanner() {
  document.getElementById('sd-install-banner')?.classList.remove('is-visible');
}

export function initPwaInstall() {
  registerServiceWorker();

  if (isStandalone()) return; // Ya instalada — no hay nada que insistir.

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    showBanner();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideBanner();
  });

  // Fallback: si Edge no dispara beforeinstallprompt (ya hay heurísticas
  // propias del navegador que a veces lo suprimen), igual mostramos el
  // banner con instrucciones manuales tras un rato.
  window.addEventListener('load', () => {
    setTimeout(showBanner, AUTO_SHOW_DELAY_MS);
  });
}
