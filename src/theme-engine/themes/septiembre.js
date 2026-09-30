/**
 * theme-engine/themes/septiembre.js — "Mes Patrio" (prefers: dark).
 * Ambiente: banderines verde/blanco/rojo (strip — Fase 3) + glow verde
 * + escudo/banderita en el encabezado.
 */
export default {
  id: 'sep',
  label: 'Mes Patrio',
  prefers: 'dark',
  tokens: {
    accent: '#1E9E6B',
    accent2: '#C8202F',
    tint: '#0D2B24',
    wash: '#E6F4EA',
    washD: '#0F4A32',
  },
  ambient: {
    glow: ['#1E9E6B', '0% -20%'],
    strip: { type: 'flags', colors: ['#1E9E6B', '#FFFFFF', '#C8202F'] },
    ornament: 'flag',
  },
};
