/**
 * theme-engine/ambient/particles.js
 * Partículas ambientales (pétalos, chispas, motas, copos) — DOM + CSS
 * puro, sin canvas ni librerías (regla 0). También vive aquí el
 * render de la luna grande de Halloween (ambient.moon:true): es un
 * elemento decorativo de la misma naturaleza (una capa estática/casi-
 * estática dentro de #ambientHost), no justifica un archivo propio.
 *
 * Presupuesto de rendimiento (sección 10 de la propuesta): máximo ~40
 * partículas SIMULTÁNEAS entre todos los temas activos, incluso en
 * Intenso — ver PARTICLE_BUDGET más abajo. Se reparte proporcional si
 * el total pedido lo excede (normalmente solo pasa durante un cruce de
 * mes con 2 temas activos a la vez).
 *
 * Nunca anima tablas, campos ni el drawer de edición — estas capas
 * viven exclusivamente dentro de #ambientHost/#tbOrnament, tal como
 * exige la sección 10 de la propuesta.
 */

const PARTICLE_BUDGET = 40;
const MIN_ANIMATED_WEIGHT = 0.02; // por debajo de esto, se pausa (sección 4 de la propuesta)

// [min,max] segundos de duración por tipo de partícula.
const DURATION = {
  petal: [8, 14],
  spark: [1.6, 3],
  mote: [10, 18],
  flake: [9, 15],
};

const rand = (min, max) => min + Math.random() * (max - min);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

function buildParticle(kind, colors, sizeRange, opacityCap) {
  const el = document.createElement('span');
  el.className = `t-particle t-particle-${kind}`;
  const size = rand(sizeRange[0], sizeRange[1]);
  const dur = rand(...DURATION[kind]);
  const fallsThrough = kind === 'petal' || kind === 'flake';
  el.style.left = `${rand(0, 100)}%`;
  el.style.top = `${fallsThrough ? -8 : rand(4, 90)}%`;
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.background = pick(colors);
  el.style.opacity = String(rand(0.3, opacityCap));
  el.style.animationDuration = `${dur}s`;
  // Delay NEGATIVO a propósito: hace que cada partícula arranque a
  // mitad de su recorrido en vez de que todas nazcan sincronizadas en
  // el fotograma 0 — se ve orgánico sin necesitar temporizadores en JS.
  el.style.animationDelay = `-${rand(0, dur)}s`;
  return el;
}

/**
 * Sincroniza las capas de partículas dentro de `host` (#ambientHost)
 * para los temas activos en `entries`. Un contenedor <div> por tema —
 * la cuenta/tamaño de sus partículas se define UNA vez al crearlo (se
 * reconstruye si cambia la intensidad); el crossfade entre temas se
 * logra con opacity = peso sobre todo el contenedor, igual criterio
 * que el resto de las capas ambientales.
 */
export function renderParticleLayers(host, entries, byId, intensity) {
  if (!host) return;

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    host.querySelectorAll('.t-particles').forEach(el => el.remove());
    return;
  }

  const countMul = intensity === '2' ? 1.9 : 1;
  const sizeMul = intensity === '2' ? 1.35 : 1;
  const opacityCap = intensity === '2' ? 0.9 : 0.5;

  const active = entries.filter(([id]) => byId.get(id)?.ambient?.particles);
  const rawCounts = active.map(([id]) => Math.round(byId.get(id).ambient.particles.n * countMul));
  const total = rawCounts.reduce((a, b) => a + b, 0);
  const scale = total > PARTICLE_BUDGET ? PARTICLE_BUDGET / total : 1;

  const wanted = new Set();
  active.forEach(([id, weight], idx) => {
    wanted.add(id);
    const cfg = byId.get(id).ambient.particles;
    let layer = host.querySelector(`.t-particles[data-theme-id="${id}"]`);
    if (layer && layer.dataset.int !== intensity) { layer.remove(); layer = null; } // cambio de intensidad → reconstruye
    if (!layer) {
      const n = Math.max(1, Math.round(rawCounts[idx] * scale));
      const sizeRange = [cfg.size[0] * sizeMul, cfg.size[1] * sizeMul];
      layer = document.createElement('div');
      layer.className = 't-particles';
      layer.dataset.themeId = id;
      layer.dataset.int = intensity;
      for (let i = 0; i < n; i++) layer.appendChild(buildParticle(cfg.kind, cfg.colors, sizeRange, opacityCap));
      host.appendChild(layer);
    }
    layer.style.opacity = String(weight);
    const playState = weight < MIN_ANIMATED_WEIGHT ? 'paused' : 'running';
    layer.querySelectorAll('.t-particle').forEach(p => { p.style.animationPlayState = playState; });
  });

  host.querySelectorAll('.t-particles[data-theme-id]').forEach(el => {
    if (!wanted.has(el.dataset.themeId)) el.remove();
  });
}

// Luna grande de Halloween (ambient.moon:true) — pálida, con glow del
// acento mezclado; 28px en Sutil, 38px + pulso en Intenso (ver CSS).
const MOON_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>';

export function renderMoon(host, entries, byId, intensity) {
  if (!host) return;
  const octEntry = entries.find(([id]) => id === 'oct' && byId.get(id)?.ambient?.moon);
  let layer = host.querySelector('.t-moon');
  if (!octEntry) { layer?.remove(); return; }

  const [, weight] = octEntry;
  const size = intensity === '2' ? 38 : 28;
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 't-moon';
    layer.innerHTML = MOON_SVG;
    host.appendChild(layer);
  }
  layer.style.width = `${size}px`;
  layer.style.height = `${size}px`;
  layer.style.opacity = String(weight);
  layer.style.animationPlayState = weight < MIN_ANIMATED_WEIGHT ? 'paused' : 'running';
}
