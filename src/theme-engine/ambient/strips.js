/**
 * theme-engine/ambient/strips.js
 * Tira decorativa fija justo debajo del topbar (#ambientStrip en
 * index.html — top:60px, z-index:49, pointer-events:none). Dibuja
 * banderines (sep), papel picado (nov) o luces (dic) como un patrón
 * SVG (<pattern>) que se repite horizontalmente — sin canvas.
 *
 * Solo los temas que declaran `ambient.strip` montan una capa aquí;
 * el resto de los meses no tiene tira (host queda con height:0).
 */

function stripPatternMarkup(themeId, type, colors, tileH) {
  const patId = `t-strip-pat-${themeId}`;

  if (type === 'flags') {
    const flagW = 30;
    const tileW = flagW * colors.length;
    const tris = colors.map((c, i) => {
      const x0 = i * flagW + 5, x1 = i * flagW + flagW - 5, xm = i * flagW + flagW / 2;
      return `<polygon points="${x0},2 ${x1},2 ${xm},${tileH - 3}" fill="${c}"/>`;
    }).join('');
    return { tileW, markup: `<pattern id="${patId}" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse">
      <line x1="0" y1="2" x2="${tileW}" y2="2" stroke="rgba(255,255,255,.4)" stroke-width="1"/>${tris}
    </pattern>`, patId };
  }

  if (type === 'picado') {
    const panelW = 26;
    const tileW = panelW * colors.length;
    const teeth = 4;
    const toothW = (panelW - 4) / teeth;
    const panels = colors.map((c, i) => {
      const x = i * panelW;
      let d = `M${x + 2},1 H${x + panelW - 2} V${tileH - 6}`;
      for (let t = teeth; t >= 1; t--) {
        const xa = x + 2 + t * toothW, xb = x + 2 + (t - 1) * toothW, xm = (xa + xb) / 2;
        d += ` L${xm},${tileH - 1} L${xb},${tileH - 6}`;
      }
      d += ' Z';
      return `<path d="${d}" fill="${c}" opacity=".92"/>`;
    }).join('');
    return { tileW, markup: `<pattern id="${patId}" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="${tileW}" y2="0" stroke="rgba(255,255,255,.3)" stroke-width="1"/>${panels}
    </pattern>`, patId };
  }

  if (type === 'lights') {
    const bulbW = 22;
    const tileW = bulbW * colors.length;
    const bulbs = colors.map((c, i) => {
      const cx = i * bulbW + bulbW / 2, cy = tileH * 0.65;
      return `<circle cx="${cx}" cy="${cy}" r="5" fill="${c}" opacity=".25"/><circle cx="${cx}" cy="${cy}" r="2.6" fill="${c}"/>`;
    }).join('');
    return { tileW, markup: `<pattern id="${patId}" width="${tileW}" height="${tileH}" patternUnits="userSpaceOnUse">
      <line x1="0" y1="${tileH * 0.35}" x2="${tileW}" y2="${tileH * 0.35}" stroke="rgba(255,255,255,.5)" stroke-width="1"/>${bulbs}
    </pattern>`, patId };
  }

  return null;
}

/**
 * Sincroniza la(s) tira(s) dentro de `host` (#ambientStrip). Altura
 * base 14px, ×1.4 en Intenso (sección 5 — "banderines/luces al 140% de
 * altura"); el drop-shadow de Intenso vive en CSS ([data-int="2"]).
 */
export function renderStrips(host, entries, byId, intensity) {
  if (!host) return;
  const baseH = 14;
  const h = intensity === '2' ? Math.round(baseH * 1.4) : baseH;

  const active = entries.filter(([id]) => byId.get(id)?.ambient?.strip);
  host.style.height = active.length ? `${h}px` : '0';

  const wanted = new Set();
  for (const [id, weight] of active) {
    wanted.add(id);
    let layer = host.querySelector(`svg[data-theme-id="${id}"]`);
    if (layer && layer.dataset.int !== intensity) { layer.remove(); layer = null; }
    if (!layer) {
      const { type, colors } = byId.get(id).ambient.strip;
      const built = stripPatternMarkup(id, type, colors, h);
      if (!built) continue;
      const wrap = document.createElement('div');
      wrap.innerHTML = `<svg data-theme-id="${id}" data-int="${intensity}" width="100%" height="100%" preserveAspectRatio="none"><defs>${built.markup}</defs><rect width="100%" height="100%" fill="url(#${built.patId})"/></svg>`;
      layer = wrap.firstElementChild;
      host.appendChild(layer);
    }
    layer.style.opacity = String(weight);
  }

  host.querySelectorAll('svg[data-theme-id]').forEach(el => {
    if (!wanted.has(el.dataset.themeId)) el.remove();
  });
}
