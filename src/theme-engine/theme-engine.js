/**
 * theme-engine/theme-engine.js
 * Dynamic Experience — Theme Engine.
 *
 * Este módulo NUNCA conoce temas concretos (ene/halloween/etc.) — solo
 * sabe leer el contrato de un tema (ver themes/default.js) desde
 * theme-registry.js, resolver qué pesos le tocan a cada fecha
 * (weightsFor) y aplicar la mezcla resultante al DOM (applyTheme). Si
 * un id de theme-registry.js se borra, cualquier peso que apuntara ahí
 * cae de vuelta a DEFAULT_THEME_ID — ver resolveRegisteredWeights().
 *
 * Fase 3: se agregan partículas (ambient/particles.js), tiras
 * (ambient/strips.js), la luna de Halloween y los dos niveles de
 * intensidad (data-int="1|2", ver computeAndApply()). Igual que en la
 * Fase 2, no hizo falta tocar weightsFor/applyTheme para esto — solo
 * mountAmbientLayers() crece con tres llamadas más.
 *
 * Fase 5: controles de Configuración (#nameModal). El grupo "Tema" se
 * genera aquí mismo desde THEME_REGISTRY (renderThemeOptionsGrid,
 * llamado una vez en init()) — así agregar un tema sigue siendo solo
 * "archivo + línea en theme-registry.js", sin tocar index.html. Los
 * grupos "Modo"/"Intensidad" son HTML estático cableado desde
 * core/app.js hacia ThemeEngine.setMode()/setIntensity() (nuevos, ver
 * el objeto exportado más abajo). syncPreferenceControls() corre al
 * final de CADA computeAndApply() — el modal siempre refleja el
 * estado real sin importárle quién disparó el cambio (clic, medianoche,
 * visibilitychange o setDebugDate).
 *
 * Integración con el sistema claro/oscuro YA existente: este módulo
 * nunca escribe `data-theme` directamente — siempre delega en
 * UI.applyTheme(mode), que es quien de verdad posee esa lógica
 * (atributo, localStorage['sd_theme'], State.theme, botón #btnTheme,
 * .theme-opt.selected). Ver sección 4 de la propuesta: "no dupliques
 * la lógica de data-theme".
 */
import { THEME_REGISTRY, DEFAULT_THEME_ID } from './theme-registry.js';
import { UI } from '../ui/ui.js';
import { renderOrnaments } from './ambient/ornaments.js';
import { renderParticleLayers, renderMoon } from './ambient/particles.js';
import { renderStrips } from './ambient/strips.js';

const LS_PREF = 'sd_theme_pref';      // 'auto' | 'default' | '<id>'
const LS_MODE = 'sd_theme_mode';      // 'auto' | 'light' | 'dark'
const LS_INT  = 'sd_theme_intensity'; // '1' | '2'
const LS_LEGACY_THEME = 'sd_theme';   // ya existente — light|dark

const MONTH_IDS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

let _debugDate = null;      // solo desarrollo — ver ThemeEngine.setDebugDate()
let _midnightTimer = null;
let _visibilityWired = false;

// ── Utilidades de color (hex ⇄ rgb, mezcla ponderada, contraste) ──
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16));
}
function rgbToHex([r, g, b]) {
  const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
/** Promedio ponderado en RGB de una lista de [hex, peso]. Pesos NO necesitan sumar 1. */
function mixHex(pairs) {
  const total = pairs.reduce((a, [, w]) => a + w, 0) || 1;
  const acc = [0, 0, 0];
  for (const [hex, w] of pairs) {
    const [r, g, b] = hexToRgb(hex);
    acc[0] += r * w; acc[1] += g * w; acc[2] += b * w;
  }
  return rgbToHex(acc.map(v => v / total));
}
function relLuminance([r, g, b]) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrastRatio(l1, l2) {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
/** Texto oscuro (#1A0F00, mismo tono que ya usa la app sobre --amber) o blanco: el de mayor contraste. */
function onAccentFor(hex) {
  const L = relLuminance(hexToRgb(hex));
  const darkContrast  = contrastRatio(L, relLuminance(hexToRgb('#1A0F00')));
  const lightContrast = contrastRatio(L, 1);
  return darkContrast >= lightContrast ? '#1A0F00' : '#FFFFFF';
}

// ── Resolución por fecha (sección 4 de la propuesta) ──
/**
 * weightsFor(date) → { idTema: peso, ... } normalizado (suma 1).
 * No sabe si esos ids existen en el registro — eso lo resuelve
 * resolveRegisteredWeights() más abajo, a propósito, para que esta
 * función sea pura tabla-de-calendario y nunca cambie al sumar/quitar
 * temas.
 */
export function weightsFor(date) {
  const y = date.getFullYear();
  const m = date.getMonth();      // 0-11
  const d = date.getDate();       // 1-based
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const curId  = MONTH_IDS[m];
  const prevId = MONTH_IDS[(m + 11) % 12];
  const nextId = MONTH_IDS[(m + 1) % 12];

  let weights;

  if (curId === 'oct') {
    const mu = 0.6 * (d - 1) / 30;
    weights = { oct: 1 - mu, nov: mu };
    if (d <= 4) weights.sep = (weights.sep || 0) + (5 - d) / 8;
  } else if (curId === 'nov') {
    const h = Math.max(0, 0.3 * (1 - (d - 1) / 19));
    weights = { nov: 1 - h, oct: h };
    if (d > daysInMonth - 4) weights.dic = (weights.dic || 0) + (d - (daysInMonth - 4)) / 8;
  } else {
    weights = { [curId]: 1 };
    if (d <= 4) weights[prevId] = (weights[prevId] || 0) + (5 - d) / 8;
    if (d > daysInMonth - 4) weights[nextId] = (weights[nextId] || 0) + (d - (daysInMonth - 4)) / 8;
  }

  const sum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(weights)) weights[k] /= sum;
  return weights;
}

/** Repliega cualquier peso que apunte a un id no registrado hacia DEFAULT_THEME_ID. */
function resolveRegisteredWeights(weights) {
  const byId = new Map(THEME_REGISTRY.map(t => [t.id, t]));
  const out = {};
  for (const [id, w] of Object.entries(weights)) {
    const targetId = byId.has(id) ? id : DEFAULT_THEME_ID;
    out[targetId] = (out[targetId] || 0) + w;
  }
  // Si ni siquiera 'default' terminó en el mapa (registro vacío/mal
  // configurado), cae aquí como último salvavidas.
  if (Object.keys(out).length === 0) out[DEFAULT_THEME_ID] = 1;
  return { weights: out, byId };
}

// ── Aplicación al DOM ──
/**
 * applyTheme(root, weights, opts) mezcla tokens y los escribe como
 * variables CSS en `root`. `opts.mode` es la preferencia del usuario
 * ('auto'|'light'|'dark'); el modo EFECTIVO (el que realmente se pinta)
 * se decide aquí y se delega a UI.applyTheme() — nunca se toca
 * data-theme desde otro lugar.
 */
export function applyTheme(root, weights, opts = {}) {
  const { mode = 'auto', intensity = '2' } = opts;
  const { weights: registered, byId } = resolveRegisteredWeights(weights);
  const entries = Object.entries(registered).filter(([, w]) => w > 0);

  const effectiveMode = mode === 'light' || mode === 'dark'
    ? mode
    : (entries.reduce((sum, [id, w]) => sum + (byId.get(id).prefers === 'dark' ? w : 0), 0) >= 0.5 ? 'dark' : 'light');

  const accent  = mixHex(entries.map(([id, w]) => [byId.get(id).tokens.accent, w]));
  const accent2 = mixHex(entries.map(([id, w]) => [byId.get(id).tokens.accent2, w]));
  const tint    = mixHex(entries.map(([id, w]) => [byId.get(id).tokens.tint, w]));
  const washField = effectiveMode === 'dark' ? 'washD' : 'wash';
  const wash    = mixHex(entries.map(([id, w]) => [byId.get(id).tokens[washField], w]));

  root.style.setProperty('--t-accent', accent);
  root.style.setProperty('--t-accent2', accent2);
  root.style.setProperty('--t-tint', tint);
  root.style.setProperty('--t-wash', wash);
  root.style.setProperty('--on-accent', onAccentFor(accent));

  UI.applyTheme(effectiveMode);

  mountAmbientLayers(entries, byId, intensity);
}

/**
 * Monta/actualiza todas las capas ambientales de los temas activos:
 * glow radial e iconos de encabezado (estáticos, Fase 2) + partículas,
 * luna de Halloween y tiras de banderines/papel picado/luces
 * (animados, Fase 3). Cada capa vive por tema — opacity = peso,
 * crossfade sin cortes — y se crea perezosamente / se retira cuando su
 * tema sale de la mezcla actual. `intensity` ('1'|'2') decide cantidad/
 * tamaño de partículas y fuerza una reconstrucción de esas capas si
 * cambió desde el último render (ver dataset.int en particles.js/
 * strips.js) — "cambiar la intensidad reconstruye las capas
 * ambientales", tal cual pide la sección 5 de la propuesta.
 */
function mountAmbientLayers(entries, byId, intensity) {
  const ambientHost = document.getElementById('ambientHost');
  renderGlowLayers(entries, byId);
  renderOrnaments(document.getElementById('tbOrnament'), entries, byId);
  renderParticleLayers(ambientHost, entries, byId, intensity);
  renderMoon(ambientHost, entries, byId, intensity);
  renderStrips(document.getElementById('ambientStrip'), entries, byId, intensity);
}

const MIN_ANIMATED_WEIGHT = 0.02; // sección 4: por debajo de esto, la capa se pausa (no anima, aunque siga montada)

function renderGlowLayers(entries, byId) {
  const host = document.getElementById('ambientHost');
  if (!host) return;
  const wanted = new Set();
  for (const [id, weight] of entries) {
    const glow = byId.get(id)?.ambient?.glow;
    if (!glow) continue;
    wanted.add(id);
    const [color, pos] = glow;
    let layer = host.querySelector(`.t-glow[data-theme-id="${id}"]`);
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 't-glow';
      layer.dataset.themeId = id;
      host.appendChild(layer);
    }
    layer.style.setProperty('--glow-color', color);
    layer.style.setProperty('--glow-pos', pos);
    layer.style.opacity = String(weight);
    layer.style.animationPlayState = weight < MIN_ANIMATED_WEIGHT ? 'paused' : 'running';
  }
  host.querySelectorAll('.t-glow[data-theme-id]').forEach(el => {
    if (!wanted.has(el.dataset.themeId)) el.remove();
  });
}

// ── Preferencias (localStorage) ──
function readPref(key, fallback) {
  const v = localStorage.getItem(key);
  return v === null ? fallback : v;
}

function resolveModePref() {
  let mode = localStorage.getItem(LS_MODE);
  if (mode === null) {
    // Migración de primera corrida: si el usuario ya tenía un tema
    // claro/oscuro elegido (sd_theme, mecanismo pre-existente), se
    // hereda tal cual en vez de forzar 'auto' — así nadie ve un cambio
    // de apariencia sorpresa el día que esta fase se despliega. Los
    // usuarios nuevos sí arrancan en 'auto' por defecto (sección 4).
    const legacy = localStorage.getItem(LS_LEGACY_THEME);
    mode = legacy === 'dark' || legacy === 'light' ? legacy : 'auto';
    localStorage.setItem(LS_MODE, mode);
  }
  return mode;
}

function currentDate() {
  return _debugDate ? new Date(_debugDate) : new Date();
}

function computeAndApply() {
  const pref = readPref(LS_PREF, 'auto');
  const intensity = readPref(LS_INT, '2');
  document.documentElement.setAttribute('data-int', intensity);

  const weights = pref === 'auto'
    ? weightsFor(currentDate())
    : { [pref]: 1 }; // 'default' o un id de tema específico, forzado

  applyTheme(document.documentElement, weights, { mode: resolveModePref(), intensity });
  syncPreferenceControls();
}

function scheduleMidnightRecheck() {
  clearTimeout(_midnightTimer);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  _midnightTimer = setTimeout(() => {
    computeAndApply();
    scheduleMidnightRecheck();
  }, next - now);
}

// ── Controles de Configuración (#nameModal) ──
// El grupo "Tema" (Automático + un tile por entrada de THEME_REGISTRY)
// se GENERA aquí en vez de vivir hardcodeado en index.html — es la
// única forma de cumplir "agregar un tema nuevo = archivo + línea en
// theme-registry.js, nada más" (sección 2): si esta lista estuviera en
// el HTML, sumar un tema también exigiría tocar index.html. Los grupos
// "Modo" e "Intensidad" son fijos (3 y 2 opciones respectivamente) y
// viven como HTML estático normal, cableados desde core/app.js junto
// con el resto de los botones del modal (mismo patrón que ya existía).
function themeOptionTile(id, label, color) {
  return `<div class="theme-opt" data-theme-id="${id}">` +
    `<span class="theme-opt-dot" style="background:${color}"></span>` +
    `<div class="theme-opt-label">${label}</div></div>`;
}

function renderThemeOptionsGrid() {
  const host = document.getElementById('cfgThemeOpts');
  if (!host) return; // Fase 1/2 en un HTML viejo sin el contenedor aún — no revienta
  const tiles = [
    themeOptionTile('auto', 'Automático', 'var(--brand-accent)'),
    ...THEME_REGISTRY.map(t => themeOptionTile(t.id, t.label, t.tokens.accent)),
  ];
  host.innerHTML = tiles.join('');
  host.addEventListener('click', e => {
    const opt = e.target.closest('.theme-opt[data-theme-id]');
    if (!opt) return;
    localStorage.setItem(LS_PREF, opt.dataset.themeId);
    computeAndApply();
  });
}

/**
 * Refleja en el modal cuál opción está activa en cada uno de los 3
 * grupos (Tema/Modo/Intensidad) — se llama al final de cada
 * computeAndApply() (cualquier cambio, venga de un clic, la medianoche
 * o un cambio de pestaña, se refleja solo) y una vez más al abrir el
 * modal (ver core/app.js — por si se abre sin que nada haya disparado
 * un recompute recién). "Automático" y "Claro/Oscuro" son MUTUAMENTE
 * EXCLUYENTES en la UI aunque UI.applyTheme() ya haya marcado Claro U
 * Oscuro como reflejo del modo EFECTIVO — si la preferencia real es
 * 'auto', se apagan ambos para que brille solo "Automático".
 */
function syncPreferenceControls() {
  const pref = readPref(LS_PREF, 'auto');
  const mode = readPref(LS_MODE, 'auto');
  const intensity = readPref(LS_INT, '2');

  document.querySelectorAll('#cfgThemeOpts .theme-opt[data-theme-id]').forEach(el => {
    el.classList.toggle('selected', el.dataset.themeId === pref);
  });

  document.getElementById('themeOptAuto')?.classList.toggle('selected', mode === 'auto');
  if (mode === 'auto') {
    document.getElementById('themeOptLight')?.classList.remove('selected');
    document.getElementById('themeOptDark')?.classList.remove('selected');
  }

  document.querySelectorAll('#cfgIntensityOpts .theme-opt[data-intensity]').forEach(el => {
    el.classList.toggle('selected', el.dataset.intensity === intensity);
  });
}

export const ThemeEngine = {
  /** Llamar una vez, dentro de continueInit() (ver core/app.js). */
  init() {
    renderThemeOptionsGrid(); // una sola vez — THEME_REGISTRY es estático durante la sesión
    computeAndApply();
    scheduleMidnightRecheck();
    if (!_visibilityWired) {
      _visibilityWired = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') computeAndApply();
      });
    }
  },
  /** Fuerza un recálculo inmediato (p.ej. tras cambiar una preferencia en Configuración). */
  recompute: computeAndApply,
  /** Fija sd_theme_mode ('auto'|'light'|'dark') y recalcula — usado por #btnTheme y el grupo "Modo" del modal. */
  setMode(mode) {
    localStorage.setItem(LS_MODE, mode);
    computeAndApply();
  },
  /** Fija sd_theme_intensity ('1'|'2') y recalcula — reconstruye las capas ambientales (sección 5). */
  setIntensity(intensity) {
    localStorage.setItem(LS_INT, intensity);
    computeAndApply();
  },
  /** Refresca el resaltado de los 3 grupos del modal SIN recalcular nada — llamar al abrir Configuración. */
  syncControls: syncPreferenceControls,
  /** SOLO DESARROLLO — simula una fecha para probar mezclas (ver criterios de aceptación). */
  setDebugDate(iso) {
    _debugDate = iso;
    computeAndApply();
  },
};
