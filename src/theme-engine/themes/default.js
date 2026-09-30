/**
 * theme-engine/themes/default.js
 * Tema base — sin ambiente (0. reglas no negociables: "un tema jamás
 * puede..."; este es el piso neutro al que cualquier peso desconocido
 * cae de vuelta). Los valores de `tokens` son exactamente los colores
 * de marca que la app ya usa hoy (--amber/--green/--navy/--paper/
 * --surface), a propósito: mientras 'default' sea el único tema activo
 * (Fase 1), --brand-accent (que resuelve a tokens.accent) debe pintar
 * IDÉNTICO a --amber actual. Ver docs del motor, sección 3 de la tabla
 * de temas aprobada.
 *
 * Contrato de un tema (dato puro, sin lógica — ver theme-engine.js):
 *   id, label, prefers ('light'|'dark', solo se usa en modo Auto),
 *   tokens: { accent, accent2, tint, wash, washD },
 *   ambient: { glow?, strip?, particles?, ornament? } — opcional.
 */
export default {
  id: 'default',
  label: 'Default',
  prefers: 'light',
  tokens: {
    accent: '#F5A623',
    accent2: '#1E9E6B',
    tint: '#0B1D33',
    wash: '#F3F5F9',
    washD: '#0E1626',
  },
  ambient: null, // sin partículas/tiras/ornamentos — tema neutro
};
