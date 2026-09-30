/**
 * theme-engine/themes/marzo.js — "Primavera" (prefers: light).
 * Ambiente: florecitas discretas. Sin glow.
 */
export default {
  id: 'mar',
  label: 'Primavera',
  prefers: 'light',
  tokens: {
    accent: '#3FAE73',
    accent2: '#F5A623',
    tint: '#0B2A25',
    wash: '#E2F5E7',
    washD: '#0F3A26',
  },
  ambient: {
    particles: { kind: 'petal', n: 9, colors: ['#BFE8C6', '#F6D6E4', '#FFFFFF'], size: [5, 8] },
    ornament: 'flower5',
  },
};
