/**
 * theme-engine/themes/febrero.js — "San Valentín" (prefers: dark).
 * Ambiente: pétalos rosa + un corazón en el encabezado. Sin glow.
 */
export default {
  id: 'feb',
  label: 'San Valentín',
  prefers: 'dark',
  tokens: {
    accent: '#D9547A',
    accent2: '#C97C0E',
    tint: '#1F1330',
    wash: '#FCE4EC',
    washD: '#4D1433',
  },
  ambient: {
    particles: { kind: 'petal', n: 8, colors: ['#F3A6BC', '#E77E9C'], size: [6, 9] },
    ornament: 'heart',
  },
};
