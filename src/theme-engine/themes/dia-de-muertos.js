/**
 * theme-engine/themes/dia-de-muertos.js — id 'nov' (Día de Muertos,
 * prefers: dark). Mismo criterio de nombre-de-archivo-vs-id que
 * halloween.js — ver ese archivo para la explicación completa.
 * Ambiente: papel picado (strip — Fase 3) + pétalos de cempasúchil
 * (partículas — Fase 3) + flor + calaverita en el encabezado (ya
 * funciona desde la Fase 2).
 */
export default {
  id: 'nov',
  label: 'Día de Muertos',
  prefers: 'dark',
  tokens: {
    accent: '#FFB020',
    accent2: '#E0437F',
    tint: '#1B0F2C',
    wash: '#FFE9C7',
    washD: '#4A2208',
  },
  ambient: {
    glow: ['#FF8A1F', '80% -20%'],
    strip: { type: 'picado', colors: ['#FFB020', '#E0437F', '#9B6BFF', '#FF7A1A'] },
    particles: { kind: 'petal', n: 14, colors: ['#FFB020', '#FF8A1F', '#FFCE4D'], size: [6, 10] },
    ornament: 'cempasuchil-calavera',
  },
};
