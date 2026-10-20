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

// CAMBIO (oct-2026 — copy de "evolución" + animaciones): se reescribe el
// mensaje de cada variante con tono de lanzamiento de producto (antes
// era puramente instructivo: "esta app se usa instalada..."). Título Y
// mensaje ahora son dinámicos por variante (antes solo el mensaje — el
// título estaba fijo en "Instala SmartDispatch para continuar" para las
// 3 variantes). El badge "Nuevo" y el brillo de los botones primarios
// viven en CSS (ver pwa-install.css — .sd-gate-badge/.sd-gate-btn-shine),
// aquí solo se decide QUÉ texto va en cada caso.
function renderGateContent() {
  const edge = isEdge();
  const canPrompt = !!deferredPrompt;
  const currentUrl = escapeAttr(window.location.href);

  let title;
  let message;
  let primaryActionHtml;
  if (edge && canPrompt) {
    title = '¡Descubre la nueva experiencia SmartDispatch!';
    message = 'SmartDispatch incorpora nuevas funciones y mejoras para facilitar tus actividades diarias. Instálala en tu equipo y disfruta de una experiencia más cómoda, con acceso directo desde tu escritorio y una ventana propia, como cualquier otra aplicación.';
    primaryActionHtml = '<button type="button" class="sd-gate-btn sd-gate-btn-primary sd-gate-btn-shine" id="sd-gate-install">Instalar ahora</button>';
  } else if (edge && !canPrompt) {
    title = '¡Descubre la nueva experiencia SmartDispatch!';
    message = 'SmartDispatch incorpora nuevas funciones y mejoras para facilitar tus actividades diarias. Instálala en tu equipo: busca el ícono de instalar en la barra de direcciones de Edge (junto a la estrella de favoritos) y haz clic ahí para tener acceso directo desde tu escritorio, en su propia ventana.';
    primaryActionHtml = '';
  } else {
    title = '¡SmartDispatch evoluciona!';
    message = 'Ya puedes disfrutar de las nuevas funciones y mejoras de SmartDispatch desde su aplicación de escritorio. Para una instalación más confiable y una mejor compatibilidad, te recomendamos instalarla desde Microsoft Edge. Copia este enlace y ábrelo en Edge. Al cargar SmartDispatch, selecciona el ícono de instalación en la barra de direcciones.';
    primaryActionHtml = `
      <a class="sd-gate-btn sd-gate-btn-primary sd-gate-btn-shine" id="sd-gate-open-edge" href="microsoft-edge:${currentUrl}">Abrir en Microsoft Edge</a>
      <button type="button" class="sd-gate-btn sd-gate-btn-ghost" id="sd-gate-copy">Copiar enlace</button>`;
  }

  return `
    <div class="sd-gate-card" role="dialog" aria-modal="true" aria-labelledby="sd-gate-title" tabindex="-1">
      <div class="sd-gate-icon-wrap">
        <img src="icons/icon-192.png" alt="" class="sd-gate-icon" width="56" height="56">
      </div>
      <span class="sd-gate-badge">Nuevo</span>
      <h2 id="sd-gate-title">${title}</h2>
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
      // CAMBIO (oct-2026): remate de éxito — el ícono dispara el "burst"
      // verde (ver .sd-gate-card.is-success en pwa-install.css) y el
      // badge "Nuevo" se retira (ya no aplica una vez instalada).
      gateEl.querySelector('.sd-gate-card').classList.add('is-success');
      gateEl.querySelector('#sd-gate-title').textContent = '¡Todo listo!';
      gateEl.querySelector('.sd-gate-msg').textContent =
        'Cierra esta pestaña y abre SmartDispatch desde el escritorio o el menú inicio.';
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
