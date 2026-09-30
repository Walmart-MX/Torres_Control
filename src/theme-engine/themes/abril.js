/**
 * theme-engine/themes/abril.js — "Primavera" (prefers: light).
 * Ambiente: florecitas más coloridas que marzo.js (mismo ícono de
 * encabezado — 5 pétalos —, paleta de partículas distinta).
 */
export default {
  id: 'abr',
  label: 'Primavera',
  prefers: 'light',
  tokens: {
    accent: '#E0709F',
    accent2: '#3FAE73',
    tint: '#1B1E3A',
    wash: '#FBE6F0',
    washD: '#3A1A48',
  },
  ambient: {
    particles: { kind: 'petal', n: 11, colors: ['#F6B4CF', '#CDB8FF', '#FFE28A'], size: [5, 8] },
    ornament: 'flower5',
  },
};
