/**
 * theme-engine/themes/enero.js — "Año Nuevo" (prefers: dark).
 * Ambiente: chispas doradas/turquesa + glow dorado arriba a la derecha.
 * Valores exactos de la tabla aprobada (sección 3) y del mockup
 * validado (docs/mockups/…html).
 */
export default {
  id: 'ene',
  label: 'Año Nuevo',
  prefers: 'dark',
  tokens: {
    accent: '#E8A81F',
    accent2: '#14B8A6',
    tint: '#0B2733',
    wash: '#DDF5F1',
    washD: '#0F4048',
  },
  ambient: {
    glow: ['#F5C15A', '80% -10%'],
    // particles/strip: datos listos para la Fase 3 — sin renderer aún.
    particles: { kind: 'spark', n: 14, colors: ['#F5C15A', '#FFFFFF', '#7FE3D4'], size: [2, 4] },
    ornament: 'spark',
  },
};
