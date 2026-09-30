/**
 * theme-engine/motion.js
 * Dynamic Experience — Fase 4: microinteracciones (sección 6 de la
 * propuesta). Utilidades PEQUEÑAS y sin estado de negocio: nunca leen
 * ni escriben State, nunca llaman a un procesador — solo mueven pixeles
 * ya puestos ahí por el resto de la app. Se importan desde ui.js/
 * app.js/events.js en los puntos exactos donde ya ocurre el evento real
 * (guardar una tarjeta, exportar, procesar una fuente, etc.) sin tocar
 * la lógica de negocio de esos flujos — solo se les agrega un vistazo.
 *
 * Todas las funciones respetan `prefers-reduced-motion: reduce`
 * devolviendo el resultado FINAL sin animación intermedia (nunca dejan
 * el DOM a medias) — ver el chequeo `reduced()` repetido abajo.
 */

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Shake (campo vacío / estado de error) ──
export function shake(el) {
  if (!el || reduced()) return;
  el.classList.remove('mi-shake');
  void el.offsetWidth; // fuerza reflow — permite re-disparar el shake si ya estaba corriendo
  el.classList.add('mi-shake');
}

// ── Destello de fondo (número/valor que acaba de cambiar) ──
export function flashBg(el, ms = 800) {
  if (!el || reduced()) return;
  el.classList.remove('mi-flash');
  void el.offsetWidth;
  el.classList.add('mi-flash');
  setTimeout(() => el.classList.remove('mi-flash'), ms);
}

// ── Pop (ícono que aparece/termina algo — 400ms) ──
export function popIcon(el) {
  if (!el || reduced()) return;
  el.classList.remove('mi-pop');
  void el.offsetWidth;
  el.classList.add('mi-pop');
}

// ── Contadores numéricos (count-up al entrar, destello si solo cambió) ──
function countFrom(el, from, to, duration, suffix) {
  const start = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cúbico — mismo espíritu que --ease
    el.textContent = Math.round(from + (to - from) * eased) + suffix;
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/**
 * animateNumber(el, value, opts): la PRIMERA vez que ve a `el` (o si
 * `opts.force`), hace count-up de 0 → value en `enterMs` (700 por
 * defecto). En renders siguientes, si el valor cambió, hace un snap +
 * destello de fondo (`flashMs`, 800 por defecto) en vez de recontar —
 * contar de nuevo en cada re-render (que puede pasar varias veces por
 * minuto mientras se corrige) se sentiría lento, no vistoso.
 */
export function animateNumber(el, value, opts = {}) {
  if (!el) return;
  const { suffix = '', enterMs = 700, flashMs = 800, force = false } = opts;
  const target = Number(value);
  if (Number.isNaN(target)) { el.textContent = value; return; }

  const prevNum = parseFloat((el.textContent || '').trim());
  const isFirstReal = el.dataset.miInit !== '1';
  el.dataset.miInit = '1';

  if (reduced()) { el.textContent = target + suffix; return; }

  if (force || isFirstReal || Number.isNaN(prevNum)) {
    countFrom(el, 0, target, enterMs, suffix);
  } else if (prevNum !== target) {
    el.textContent = target + suffix;
    flashBg(el, flashMs);
  }
  // si no cambió, no se toca — evita destellos sobre valores idénticos.
}

// ── Secuencia de guardado de una tarjeta de corrección ──
// spinner (550ms) → "\u2713 Guardado" (pausa breve) → colapso de altura
// (260ms, reutiliza `transition:all .3s ease` que .fix-card ya trae) →
// recién ENTONCES se dispara `commit` (el guardado real / re-render).
export function runSaveSequence(card, btn, commit, opts = {}) {
  if (!card || !btn || !commit || btn.dataset.miBusy === '1') return;
  const { spinnerMs = 550, doneMs = 300, collapseMs = 260 } = opts;

  if (reduced()) { commit(); return; }

  btn.dataset.miBusy = '1';
  btn.disabled = true;
  btn.classList.add('mi-btn-spin');

  setTimeout(() => {
    btn.classList.remove('mi-btn-spin');
    btn.textContent = '\u2713 Guardado'; // \u2713 escapado a propósito — el filtro de emojis de este entorno vacía el glyph literal en llamadas a herramientas
    setTimeout(() => {
      // Se mide la altura REAL antes de colapsar (en vez de un
      // max-height fijo adivinado) — una tarjeta de marchamos puede
      // tener varias filas, un techo arbitrario la recortaría en su
      // estado normal. Ver motion.css: .fix-card{overflow:hidden} sin
      // max-height propio, así que fijarlo aquí no afecta nada hasta
      // que se agrega .mi-collapse en el mismo tick.
      card.style.maxHeight = card.scrollHeight + 'px';
      void card.offsetHeight; // fuerza reflow para que el navegador registre el valor de arriba antes del cambio a 0
      card.classList.add('mi-collapse');
      setTimeout(commit, collapseMs);
    }, doneMs);
  }, spinnerMs);
}

// ── Ráfaga única de partículas (éxito de exportación) — NO es la capa
//    ambiental continua de la Fase 3; esta se autodestruye en <1s. ──
export function burst(originEl, opts = {}) {
  if (!originEl || reduced()) return;
  const { count = 14, duration = 700 } = opts;
  const rect = originEl.getBoundingClientRect();
  const styles = getComputedStyle(document.documentElement);
  const colors = [
    styles.getPropertyValue('--t-accent').trim() || '#F5A623',
    styles.getPropertyValue('--t-accent2').trim() || '#1E9E6B',
  ];

  const host = document.createElement('div');
  host.className = 'mi-burst-host';
  host.style.left = `${rect.left + rect.width / 2}px`;
  host.style.top = `${rect.top + rect.height / 2}px`;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = 'mi-burst-particle';
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const dist = 40 + Math.random() * 50;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = `${duration}ms`;
    host.appendChild(p);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), duration + 60);
}

/** Botón de exportación: "\u2713 Exportado" + ráfaga, y se restaura solo. */
export function exportSuccess(btn) {
  if (!btn) return;
  const prev = btn.textContent;
  if (reduced()) { burst(btn); return; } // sin swap de texto temporal, pero la ráfaga igual se salta arriba
  btn.textContent = '\u2713 Exportado'; // \u2713 escapado, mismo motivo que en runSaveSequence()
  burst(btn);
  setTimeout(() => { btn.textContent = prev; }, 900);
}

// ── Ripple delegado (click en cualquier botón conocido) ──
const RIPPLE_SELECTOR = '.btn, .fix-save, .fix-save-marchamo';
let _rippleWired = false;
export function wireButtonRipple(root = document) {
  if (_rippleWired) return; // idempotente — ThemeEngine/app.js pueden llamarlo sin duplicar el listener
  _rippleWired = true;
  root.addEventListener('click', e => {
    if (reduced()) return;
    const target = e.target.closest(RIPPLE_SELECTOR);
    if (!target || target.disabled) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ripple = document.createElement('span');
    ripple.className = 'mi-ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    target.appendChild(ripple);
    setTimeout(() => ripple.remove(), 480);
  });
}

// ── Toasts (máximo 3 visibles, entrada 220ms, vida 3.8s, salida 160ms) ──
let _toastHost = null;
function ensureToastHost() {
  if (_toastHost) return _toastHost;
  _toastHost = document.createElement('div');
  _toastHost.id = 'miToastHost';
  _toastHost.className = 'mi-toasts';
  document.body.appendChild(_toastHost);
  return _toastHost;
}
function removeToast(el) {
  if (!el || el.dataset.miLeaving === '1') return;
  el.dataset.miLeaving = '1';
  if (reduced()) { el.remove(); return; }
  el.classList.add('mi-toast-out');
  setTimeout(() => el.remove(), 160);
}
/** toast(message, type) — type: 'info'|'ok'|'warn'|'err'. */
export function toast(message, type = 'info') {
  const host = ensureToastHost();
  const existing = host.querySelectorAll('.mi-toast');
  if (existing.length >= 3) removeToast(existing[0]);

  const el = document.createElement('div');
  el.className = `mi-toast mi-toast-${type}`;
  const span = document.createElement('span');
  span.textContent = message;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mi-toast-x';
  closeBtn.setAttribute('aria-label', 'Cerrar');
  closeBtn.textContent = '\u2715'; // \u2715 (cruz de cerrar) escapado, mismo motivo
  el.append(span, closeBtn);
  host.appendChild(el);

  const timer = setTimeout(() => removeToast(el), 3800);
  closeBtn.addEventListener('click', () => { clearTimeout(timer); removeToast(el); });
}

export const Motion = {
  shake, flashBg, popIcon, animateNumber, runSaveSequence,
  burst, exportSuccess, wireButtonRipple, toast,
};
