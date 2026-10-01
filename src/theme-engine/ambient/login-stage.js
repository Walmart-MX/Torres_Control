/**
 * theme-engine/ambient/login-stage.js
 * Dynamic Experience — la escena del login.
 *
 * Petición explícita (sep-2026): en el overlay de autenticación el
 * tema SÍ puede tener total protagonismo — es la única pantalla de
 * toda la app que no es una superficie de trabajo (no hay tablas,
 * inputs de captura ni botones que proteger de distracciones), así
 * que aquí la regla del 80/20 (sección 0) no aplica: puede ir a fondo.
 *
 * Importante — esto NO es una cuarta capa de lógica nueva: reutiliza
 * tal cual renderParticleLayers/renderMoon (particles.js) y
 * renderOrnaments (ornaments.js) y renderStrips (strips.js), solo que
 * montadas en hosts propios del login (#authAmbient/#authOrnament/
 * #authStrip, ver index.html) en vez de los del topbar/shell. El
 * tamaño/posición "gigante" del ornamento y el alto extra de la tira
 * son pura CSS (ver theme-engine.css) — cero duplicación de lógica.
 *
 * El login SIEMPRE se muestra en intensidad "2" (Intenso) sin importar
 * sd_theme_intensity: es una vitrina de un solo vistazo, no una
 * pantalla donde se trabaja horas — aquí el dinamismo no le resta
 * nada a nadie. Partículas/animaciones siguen respetando
 * prefers-reduced-motion (eso ya lo filtran particles.js/renderMoon
 * internamente, no hay nada que repetir aquí).
 */
import { renderOrnaments } from './ornaments.js';
import { renderParticleLayers, renderMoon } from './particles.js';
import { renderStrips } from './strips.js';

const LOGIN_INTENSITY = '2';
const LOGIN_STRIP_HEIGHT = 46; // vs. 14px en el topbar — aquí sobra espacio vertical

export function renderLoginStage(entries, byId) {
  const particleHost = document.getElementById('authAmbient');
  const ornamentHost = document.getElementById('authOrnament');
  const stripHost = document.getElementById('authStrip');
  // Si el HTML del login no trae estos hosts (p.ej. una vista de
  // pruebas recortada), no revienta — simplemente no hay escena.
  if (!particleHost && !ornamentHost && !stripHost) return;

  renderParticleLayers(particleHost, entries, byId, LOGIN_INTENSITY);
  renderMoon(particleHost, entries, byId, LOGIN_INTENSITY);
  renderOrnaments(ornamentHost, entries, byId);
  renderStrips(stripHost, entries, byId, LOGIN_INTENSITY, { baseHeight: LOGIN_STRIP_HEIGHT });
}
