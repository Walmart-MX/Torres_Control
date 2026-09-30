/**
 * theme-engine/ambient/ornaments.js
 * Iconos SVG pequeños del encabezado (montados en #tbOrnament, junto a
 * .tb-user en el topbar — ver index.html). Este módulo NO decide pesos
 * ni fechas: solo sabe dibujar un ícono dada su clave (ambient.ornament
 * de cada tema) y mantener el host sincronizado con la mezcla activa —
 * un <span> por tema con ornamento, opacity = peso (crossfade sin
 * cortes, igual criterio que el resto de las capas ambientales).
 */

/** Genera una "flor" de n pétalos — idéntica a la del mockup aprobado. */
const flower = n => {
  let s = '<svg viewBox="0 0 24 24" width="18" height="18"><g fill="currentColor" opacity=".9">';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    s += `<circle cx="${(12 + Math.cos(a) * 6.2).toFixed(1)}" cy="${(12 + Math.sin(a) * 6.2).toFixed(1)}" r="3.6"/>`;
  }
  return s + '</g><circle cx="12" cy="12" r="3.2" fill="#7A3B00"/></svg>';
};

const SKULL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3C7.6 3 5 6 5 9.6c0 2.3 1 3.8 2.5 4.8V18h9v-3.6c1.5-1 2.5-2.5 2.5-4.8C19 6 16.4 3 12 3z"/><circle cx="9.2" cy="10" r="1.6" fill="currentColor"/><circle cx="14.8" cy="10" r="1.6" fill="currentColor"/><path d="M12 12.5l-1 1.8h2zM9.5 18v2.5M12 18v2.5M14.5 18v2.5"/></svg>';

/** Diccionario clave → markup SVG. Cada tema referencia una clave de aquí en `ambient.ornament`. */
export const ORNAMENTS = {
  spark: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M12 20.5s-7.5-4.8-9-9.5A5 5 0 0 1 12 6.8a5 5 0 0 1 9 4.2c-1.5 4.7-9 9.5-9 9.5z"/></svg>',
  flower5: flower(5),
  flower6: flower(6),
  sun: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="4.4" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></g></svg>',
  flag: '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="5" cy="12" r="3.6" fill="#1E9E6B"/><circle cx="12" cy="12" r="3.6" fill="#fff" stroke="rgba(120,130,150,.6)" stroke-width=".8"/><circle cx="19" cy="12" r="3.6" fill="#C8202F"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>',
  star: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.7L12 17.5 6.1 20.8l1.3-6.7L2.5 9.5l6.6-.8z"/></svg>',
  'cempasuchil-calavera': flower(8) + SKULL,
};

/**
 * Sincroniza las capas de ornamento dentro de `host` (#tbOrnament) para
 * los temas activos en `entries` (array [id, peso] ya resuelto contra
 * el registro). Crea capas perezosamente, actualiza su opacity al peso
 * actual, y elimina las de temas que salieron de la mezcla.
 */
export function renderOrnaments(host, entries, byId) {
  if (!host) return;
  const wanted = new Set();
  for (const [id, weight] of entries) {
    const key = byId.get(id)?.ambient?.ornament;
    if (!key || !ORNAMENTS[key]) continue;
    wanted.add(id);
    let layer = host.querySelector(`[data-theme-id="${id}"]`);
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'tb-orn-layer';
      layer.dataset.themeId = id;
      layer.innerHTML = ORNAMENTS[key];
      host.appendChild(layer);
    }
    layer.style.opacity = String(weight);
  }
  host.querySelectorAll('[data-theme-id]').forEach(el => {
    if (!wanted.has(el.dataset.themeId)) el.remove();
  });
}
