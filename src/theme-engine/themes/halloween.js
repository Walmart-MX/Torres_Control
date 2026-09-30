/**
 * theme-engine/themes/halloween.js — id 'oct' (Halloween, prefers: dark).
 * El archivo lleva el nombre cultural (sección 2 de la propuesta), pero
 * el `id` interno sigue siendo el mes ('oct') porque theme-engine.js →
 * weightsFor() resuelve por calendario usando esos ids exactos (ver
 * MONTH_IDS y el caso especial de octubre/noviembre).
 * Ambiente: luna con glow + motas naranja/morado (partículas — Fase 3).
 */
export default {
  id: 'oct',
  label: 'Halloween',
  prefers: 'dark',
  tokens: {
    accent: '#FF7A1A',
    accent2: '#9B6BFF',
    tint: '#150C26',
    wash: '#EBDDFB',
    washD: '#34125C',
  },
  ambient: {
    glow: ['#FF7A1A', '85% -20%'],
    particles: { kind: 'mote', n: 12, colors: ['#FF7A1A', '#9B6BFF'], size: [2, 4] },
    ornament: 'moon',
    // moon:true — bandera para la luna grande de fondo (38px, con pulso
    // en Intensidad 2) que monta la Fase 3; el ícono pequeño del
    // encabezado (ornament:'moon') ya funciona desde la Fase 2.
    moon: true,
  },
};
