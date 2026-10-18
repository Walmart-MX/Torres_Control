/**
 * theme-engine/ambient/ornaments.js
 * Iconos pequeños del encabezado (montados en #tbOrnament, junto a
 * .tb-user en el topbar -- ver index.html). Este modulo NO decide pesos
 * ni fechas: solo sabe dar el emoji dada su clave (ambient.ornament de
 * cada tema) y mantener el host sincronizado con la mezcla activa --
 * un <span> por tema con ornamento, opacity = peso (crossfade sin
 * cortes, igual criterio que el resto de las capas ambientales).
 *
 * CAMBIO (oct-2026 -- migracion 100% a emoji, ver docs/convenciones_ui.md):
 * antes cada clave dibujaba un SVG inline que heredaba el color del
 * tema via `currentColor` (regla `.tb-ornament { color: var(--brand-accent) }`
 * en theme-engine.css). El emoji nativo NO se puede recolorear por CSS
 * -- esa regla de color queda inerte para estos elementos, es un
 * trade-off aceptado a cambio de consistencia visual con el resto de
 * la app (que ya usa emoji como icono en todos lados). Se documenta
 * aqui para que nadie se pregunte por que `color` ya no hace nada.
 *
 * Los valores se arman con String.fromCodePoint() (no con el caracter
 * literal) a proposito: el pipeline de este agente filtra emoji
 * literales al escribir archivos, los codepoints numericos no.
 */

/** Diccionario clave -> emoji. Cada tema referencia una clave de aqui en `ambient.ornament`. */
export const ORNAMENTS = {
  spark:   String.fromCodePoint(10024),            // sparkles (destello)
  heart:   String.fromCodePoint(10084),            // heavy black heart
  flower5: String.fromCodePoint(127800),           // cherry blossom
  flower6: String.fromCodePoint(127800),           // cherry blossom (mismo glifo -- el conteo de petalos no se puede expresar en emoji)
  sun:     String.fromCodePoint(9728),             // sol
  flag:    String.fromCodePoint(127474, 127485),   // bandera de Mexico (regional indicators M+X) -- antes: 3 circulos verde/blanco/rojo
  moon:    String.fromCodePoint(127769),           // luna creciente
  star:    String.fromCodePoint(11088),            // estrella
  'cempasuchil-calavera': String.fromCodePoint(128128) + String.fromCodePoint(127800), // calavera + flor -- antes: flor de 8 petalos + craneo SVG
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
      layer.textContent = ORNAMENTS[key];
      host.appendChild(layer);
    }
    layer.style.opacity = String(weight);
  }
  host.querySelectorAll('[data-theme-id]').forEach(el => {
    if (!wanted.has(el.dataset.themeId)) el.remove();
  });
}
