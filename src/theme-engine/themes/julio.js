/**
 * theme-engine/themes/julio.js — "Verano" (prefers: light).
 * Ambiente: glow cálido. Sin partículas.
 */
export default {
  id: 'jul',
  label: 'Verano',
  prefers: 'light',
  tokens: {
    accent: '#F27B2E',
    accent2: '#17A9BF',
    tint: '#0B2540',
    wash: '#FFE8D2',
    washD: '#4D2508',
  },
  ambient: {
    glow: ['#FF9A4D', '90% -15%'],
    ornament: 'sun',
  },
};
