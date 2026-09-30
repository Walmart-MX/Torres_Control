/**
 * theme-engine/themes/junio.js — "Inicio de verano" (prefers: light).
 * Ambiente: glow cian + destellos blancos.
 */
export default {
  id: 'jun',
  label: 'Inicio de verano',
  prefers: 'light',
  tokens: {
    accent: '#17A9BF',
    accent2: '#F5A623',
    tint: '#0A2A40',
    wash: '#DCF4F9',
    washD: '#0B3A4A',
  },
  ambient: {
    glow: ['#7FE3F0', '90% -15%'],
    particles: { kind: 'spark', n: 6, colors: ['#FFFFFF'], size: [2, 3] },
    ornament: 'sun',
  },
};
