/**
 * theme-engine/themes/navidad.js — id 'dic' (Navidad, prefers: dark).
 * Ambiente: luces cálidas (strip — Fase 3) + nieve muy tenue
 * (partículas — Fase 3) + estrella en el encabezado (Fase 2). Sin glow
 * propio (ver tabla sección 3 — "luces cálidas, nieve muy tenue,
 * estrella", ningún glow listado).
 */
export default {
  id: 'dic',
  label: 'Navidad',
  prefers: 'dark',
  tokens: {
    accent: '#F5C542',
    accent2: '#E5484D',
    tint: '#0A1F1A',
    wash: '#DDF3E8',
    washD: '#0F4A38',
  },
  ambient: {
    strip: { type: 'lights', colors: ['#F5C542', '#E5484D', '#4FD18B', '#7FB6FF'] },
    particles: { kind: 'flake', n: 16, colors: ['#FFFFFF'], size: [2, 4] },
    ornament: 'star',
  },
};
