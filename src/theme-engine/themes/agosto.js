/**
 * theme-engine/themes/agosto.js — "Verano" (prefers: light).
 * Ambiente: glow mínimo — este mes es, a propósito, casi idéntico a
 * 'default' (misma identidad base, ver tabla sección 3).
 */
export default {
  id: 'ago',
  label: 'Verano',
  prefers: 'light',
  tokens: {
    accent: '#F5A623',
    accent2: '#1E9E6B',
    tint: '#0B1D33',
    wash: '#F6EEDA',
    washD: '#3E2E0A',
  },
  ambient: {
    glow: ['#F5A623', '90% -20%'],
  },
};
