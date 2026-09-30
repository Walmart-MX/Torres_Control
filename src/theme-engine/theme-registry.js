/**
 * theme-engine/theme-registry.js
 * Registro de temas — la ÚNICA lista que theme-engine.js consulta para
 * saber qué temas existen. Agregar un tema nuevo es: crear su archivo
 * en themes/ e importarlo + sumar una línea al arreglo de abajo. Quitar
 * un tema es borrar esa línea — el motor cae de vuelta a 'default' para
 * cualquier peso que apuntara a un id que ya no está aquí (ver
 * theme-engine.js → resolveRegisteredWeights()), así que nunca truena.
 *
 * Fase 2: los 13 temas de la tabla aprobada (sección 3). Los ids 'oct'/
 * 'nov'/'dic' viven en archivos con nombre cultural (halloween.js,
 * dia-de-muertos.js, navidad.js) — ver esos archivos para la
 * explicación de por qué el `id` interno sigue siendo el mes.
 */
import defaultTheme from './themes/default.js';
import enero from './themes/enero.js';
import febrero from './themes/febrero.js';
import marzo from './themes/marzo.js';
import abril from './themes/abril.js';
import mayo from './themes/mayo.js';
import junio from './themes/junio.js';
import julio from './themes/julio.js';
import agosto from './themes/agosto.js';
import septiembre from './themes/septiembre.js';
import halloween from './themes/halloween.js';
import diaDeMuertos from './themes/dia-de-muertos.js';
import navidad from './themes/navidad.js';

export const THEME_REGISTRY = [
  defaultTheme,
  enero,
  febrero,
  marzo,
  abril,
  mayo,
  junio,
  julio,
  agosto,
  septiembre,
  halloween,
  diaDeMuertos,
  navidad,
];

export const DEFAULT_THEME_ID = 'default';
