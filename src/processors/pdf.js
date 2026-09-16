/**
 * processors/pdf.js
 * Extracción y parseo de los PDFs de cargas (formato Walmart CeDis).
 *
 * Dos funciones encadenadas:
 *   pdfExtract(file) → lee el PDF con pdf.js, devuelve líneas de texto
 *                       agrupadas por posición Y, y anotaciones FreeText (citas).
 *   parsePDF(extracted, filename) → interpreta esas líneas con regex
 *                       específicas del formato del documento, devuelve
 *                       { rows, unrecognizedCitas } — ver CAMBIO (Fase 0)
 *                       más abajo para el segundo campo.
 *
 * FIX DE INTEGRIDAD DE DATOS — extracción tolerante por campo (jul-2026):
 *   Antes, ROW_RE capturaba factura + tarimas + marchamo de encabezado
 *   en UN SOLO regex atómico con el marchamo forzado a `\d{5,6}`. Si el
 *   marchamo llegaba con formato inválido (ej. "3732226", 7 dígitos),
 *   el regex COMPLETO fallaba — se perdían también factura y tarimas,
 *   que sí eran válidos y pertenecían legítimamente a esa entrega.
 *   Esa era la validación "todo o nada" real: no estaba en merge.js
 *   (que decide si usar un bloque ya extraído), sino aquí, en cómo se
 *   reconocía la posición de cada campo dentro del bloque.
 *
 *   Ahora la extracción y la validación del marchamo están desacopladas:
 *     - ROW_RE / CONT_RE reconocen la posición del marchamo con un
 *       patrón amplio (\S+) — así factura, tarimas y destino se separan
 *       correctamente SIEMPRE, sin importar si el marchamo es válido.
 *     - Cada marchamo candidato (encabezado + continuaciones) se valida
 *       de forma independiente contra el formato estricto (_isValidMarchamo).
 *     - Si es válido → se conserva en `marchamos[i]`.
 *     - Si no → esa posición queda '' (nunca se inventa ni se reutiliza
 *       un valor de otra entrega) y se registra en `marchamoIssues`
 *       (valor crudo descartado, para diagnóstico) — ver
 *       features/validation/sve.js, regla 'bad_march'.
 *   Ningún campo inválido invalida ni afecta a los demás campos del
 *   mismo bloque — principio de "máxima recuperación de información
 *   confiable, mínima intervención manual".
 *
 * FIX (jul-2026) — "bug del marchamo ausente por completo":
 *   El fix anterior (párrafo de arriba) resolvía el caso "hay un token
 *   de marchamo, pero tiene formato inválido". Quedaba sin cubrir un
 *   caso distinto y real: una entrega que NO TIENE NINGÚN token de
 *   marchamo en la línea de encabezado (posición vacía, no inválida).
 *   ROW_RE seguía exigiendo el grupo del marchamo como OBLIGATORIO
 *   (`(\S+)$`, sin '?') — si esa posición venía vacía, el regex
 *   COMPLETO fallaba, y con él se perdían factura, tarimas y destino,
 *   aunque sí existieran en el PDF (caso reportado: Ruta 5205, Entrega
 *   6154001 — factura y cita presentes en el PDF, solo faltaba
 *   marchamo). La entrega terminaba marcada como 'dette_sin_pdf'
 *   ("¿se quedó por ocupación?") en vez de simplemente "sin marchamo".
 *
 *   Se vuelve opcional el grupo de marchamo en ROW_RE — mismo criterio
 *   que CONT_RE (línea de continuación) ya aplicaba en su grupo 2.
 *   _pushMarchamo() ya maneja `undefined` de forma segura (early
 *   return sin tocar marchamos ni marchamoIssues), así que no requiere
 *   ningún cambio adicional. Efecto: la entrega se matchea con
 *   normalidad (OPERADOR/LIC./FAC_PDF/CITA se resuelven igual que en
 *   las demás entregas de la ruta) y MARCHAMO 1 queda vacío — lo cual
 *   activa la regla SVE 'no_march' (quick-fix de un solo campo), no
 *   'dette_sin_pdf'.
 *
 * FIX (jul-2026) — "falso positivo por HUB repetido físicamente":
 *   Efecto colateral del fix anterior. Un HUB puede aparecer impreso
 *   varias veces dentro del MISMO PDF de una ruta individual (mismo
 *   destino repetido), pero físicamente es UNA sola entrega — solo el
 *   primer bloque trae marchamos, las repeticiones llegan sin ellos.
 *
 *   Antes del fix "marchamo opcional", esas repeticiones sin marchamo
 *   simplemente no matcheaban ROW_RE — un dedupe implícito y
 *   accidental, pero funcional (solo un rawRow por destino llegaba a
 *   result). Con el marchamo opcional, TODAS las repeticiones matchean
 *   y generan su propio rawRow con el mismo `destino`; luego
 *   events.js → handlePDFs() los indexa bajo la MISMA clave
 *   (`ruta|D|destino`) en State.pdfData — el último `.set()` gana. Si
 *   el bloque sin marchamos se procesaba después del que sí los tenía,
 *   pisaba al correcto → falso 'no_march' (caso reportado: Ruta 5106,
 *   Entrega 6154000).
 *
 *   Se agrega _dedupeByDestino() — consolida bloques que comparten
 *   `destino` en UNA sola entrega, quedándose con los marchamos de
 *   cualquiera de las repeticiones que sí los traiga. Se aplica en la
 *   ruta individual (rama `else` de parsePDF) — un HUB repetido es una
 *   sola entrega real, debe consolidarse. NOTA (sep-2026): antes
 *   también se aplicaba en la rama "destinos distintos" del PDF
 *   unificado; esa rama se retiró por completo — ver FIX (sep-2026)
 *   más abajo, "generalización de rutas unificadas con destinos
 *   distintos". _dedupeByDestino() ahora es exclusivo de la ruta
 *   individual.
 *
 * FIX (jul-2026) — HR. DESPACHO con fecha invertida:
 *   El sello "Impreso/enviado por fax" del PDF imprime la fecha en
 *   formato inglés MM-DD-YYYY (confirmado con muestra real:
 *   "07-26-2026 01:28:46 CT" = 26 de julio de 2026), pero el código
 *   anterior tomaba los tres números tal cual y los unía sin
 *   reordenar, asumiendo que ya venían como DD/MM/YYYY. Resultado: se
 *   guardaba "07/26/2026" (mes=07, "día"=26) y parseDateTime()/
 *   normalizeAppointment() (utils/date.js), que SIEMPRE interpretan el
 *   primer número como día y el segundo como mes, terminaban armando
 *   new Date(2026, 25, 7, ...) — mes 26 desborda en JavaScript y
 *   "rueda" el año hacia adelante (de ahí el salto a 2028 observado en
 *   producción). Se invierten aquí mismo pts[0]/pts[1] al capturar la
 *   fecha del sello, para dejarla en DD/MM/YYYY, formato que espera el
 *   resto de la app — ningún otro módulo (date.js, merge.js,
 *   constants.js) cambia.
 *
 * FIX (ago-2026) — "bug del reparto desigual de marchamos en rutas
 * unificadas con destino compartido":
 *   Caso real confirmado con EduarDo (PDF 1205-1206.pdf, HUB 6154001
 *   compartido por ambas rutas). El split anterior de la rama
 *   sameDestino dividía rawRows exactamente A LA MITAD por CONTEO de
 *   filas (`mid = Math.ceil(rawRows.length / 2)`), asumiendo que ambas
 *   rutas aportan el mismo número de entregas al documento. WTMS no
 *   garantiza eso — cada ruta corresponde a un remolque (Placa
 *   Trailer) distinto, y cada remolque puede traer un número de
 *   entregas completamente distinto (caso real: 4 filas para un
 *   remolque, 9 para el otro). Con conteo desigual, el corte a la
 *   mitad cae DENTRO del bloque de la segunda ruta — la fila que
 *   realmente lleva los marchamos de ese remolque (siempre la PRIMERA
 *   fila de cada bloque; WTMS solo los imprime ahí, el resto de filas
 *   del mismo remolque llegan sin marchamo) terminaba del lado
 *   equivocado del corte. Resultado observado: la ruta con menos
 *   filas se quedaba sin ningún marchamo ("sin marchamo principal"),
 *   mientras la otra recibía DOS juegos de marchamos mezclados.
 *
 *   Además, el orden de asignación estaba invertido: el código
 *   asumía que el PRIMER bloque del documento (el de más arriba)
 *   pertenece a la ruta con el número MENOR de las dos (orden de
 *   aparición en el nombre del archivo, ej. "1205" en "1205-1206.pdf").
 *   Confirmado con EduarDo: WTMS imprime, de arriba hacia abajo,
 *   primero el bloque de la ruta con el número MAYOR (1206) y después
 *   el de la ruta con el número MENOR (1205) — exactamente al revés.
 *
 *   Se corrigen ambos problemas:
 *     1) _splitUnifiedBlocksByMarchamo() reemplaza el corte por
 *        conteo: detecta el inicio real de cada bloque físico
 *        (remolque) buscando la fila que trae sus propios marchamos
 *        — la única señal fiable de "aquí empieza un remolque nuevo",
 *        ya que WTMS solo la imprime una vez por bloque. Si no se
 *        detectan EXACTAMENTE 2 bloques (ej. ninguna fila trae
 *        marchamo, o se detecta un patrón inesperado), se conserva el
 *        corte por mitad como respaldo — mismo comportamiento que
 *        antes, nunca peor — con una advertencia en consola para
 *        diagnóstico.
 *     2) La asignación ruta↔bloque ahora ordena `rutas` por valor
 *        NUMÉRICO descendente antes de repartir los bloques — el
 *        primer bloque (el de más arriba) siempre va a la ruta con el
 *        número mayor, el segundo a la de número menor — en vez de
 *        asumir que `rutas` (tomado tal cual del nombre del archivo)
 *        ya viene en ese orden.
 *
 *   NOTA (sep-2026): esta lógica de partición por remolque, que
 *   originalmente solo se aplicaba cuando ambas rutas compartían
 *   destino (`sameDestino === true`), ahora se aplica a TODA ruta
 *   unificada sin importar sus destinos — ver FIX (sep-2026) más abajo,
 *   "generalización de rutas unificadas con destinos distintos". La
 *   regla física (un remolque = una ruta, primero el bloque de la ruta
 *   con número mayor) no depende de si los destinos coinciden.
 *
 * FIX (ago-2026) — factura con formato inválido no debe perder la
 * entrega completa:
 *   Caso real confirmado con EduarDo (ruta 4404, Entrega 2597): la
 *   factura del PDF traía un typo de origen ("4629160446" en vez de
 *   "4659060446" — 2 dígitos distintos, no una diferencia de
 *   formato). ROW_RE exigía el prefijo "4659" DENTRO del regex
 *   estructural de la fila completa — si no coincidía, el regex
 *   COMPLETO fallaba y la entrega entera (factura/tarimas/marchamos/
 *   destino) nunca se extraía, aunque el resto de los datos fueran
 *   perfectamente válidos. Consecuencia real: merge.js no encontraba
 *   ningún bloque de PDF para esa entrega y sve.js reportaba
 *   'dette_sin_pdf' ("¿se quedó por ocupación?") — un falso positivo,
 *   el bloque sí existía en el PDF.
 *
 *   Mismo principio que ya se aplicó a marchamos (extracción tolerante
 *   por campo): ROW_RE ahora captura CUALQUIER corrida de 10 dígitos
 *   en la posición de factura, sin exigir el prefijo estructuralmente.
 *   La validación real de formato (_isValidFactura()) se hace DESPUÉS
 *   de capturar — si no pasa, se registra en `facturaIssues` (mismo
 *   patrón que `marchamoIssues`) para diagnóstico vía sve.js (regla
 *   'bad_fact', INFORMATIVA).
 *
 *   DIFERENCIA IMPORTANTE respecto a un marchamo inválido: la factura
 *   NUNCA se vacía, sin importar si el formato es inválido. Vaciarla
 *   rompería el match específico contra el Excel (merge.js busca
 *   `ruta + '|' + factura`) sin ganar nada a cambio — a diferencia de
 *   un marchamo, donde no hay ningún otro dato que dependa de su
 *   valor. Se conserva tal cual se extrajo del PDF.
 *
 * FIX (sep-2026) — HUBs de "ruta alterna" generan falsos positivos de
 * ambigüedad/ausencia de PDF:
 *   Caso real confirmado con EduarDo: los HUB 29999138, 29999227 y
 *   29999230 aparecen en el PDF como una "Entrega 1" separada, con una
 *   sola línea de datos de conteos triviales (GLS=1, Tarimas=1,
 *   Posiciones=1, Cajas=1) seguida de su propio "Total de ordenes de
 *   compra... Fin del informe" — un bloque de relleno que WTMS agrega
 *   cuando la carga tomó alguna ruta alterna, NO una entrega real.
 *
 *   Antes de este fix, si la factura de ese bloque de relleno resultaba
 *   tener 10 dígitos con prefijo 4659 (coincidencia de formato, caso
 *   real: PDF 6204-6205), ROW_RE SÍ generaba un rawRow válido para él
 *   — agregando un `destino` extra falso al documento unificado, lo
 *   cual disparaba la generalización de destinos distintos (ver FIX
 *   más abajo) y podía desalinear la asignación de bloques por
 *   remolque. Se filtran estos tres HUB de IGNORED_ALT_ROUTE_DESTINOS
 *   inmediatamente después de construir `rawRows` — antes de calcular
 *   destinos, antes de dividir en bloques por remolque, y antes de
 *   cualquier dedupe — para que nunca cuenten como una entrega real,
 *   sin importar el formato accidental de su factura.
 *
 * FIX (sep-2026) — generalización de rutas unificadas con destinos
 * distintos:
 *   Antes de este fix, `parsePDF()` bifurcaba el manejo de una ruta
 *   unificada según si ambas rutas compartían el mismo HUB destino
 *   (`sameDestino`):
 *     - sameDestino === true  → dividía por remolque (marchamo) y
 *       asignaba cada bloque completo a su ruta real (ver FIX
 *       ago-2026 arriba) — esto SÍ funcionaba correctamente.
 *     - sameDestino === false → NUNCA dividía por remolque. Solo
 *       deduplicaba por destino (_dedupeByDestino) sobre TODAS las
 *       filas del documento mezcladas, y asignaba `ruta: baseName`
 *       (el nombre completo del archivo, ej. "6204-6205") a TODAS las
 *       entregas resultantes — un bug real: ninguna entrega podía
 *       hacer match contra el número de ruta individual en merge.js,
 *       así que AMBAS rutas del PDF terminaban reportadas como "sin
 *       PDF asociado" (regla SVE 'no_pdf').
 *
 *   Caso real confirmado con EduarDo: las rutas unificadas no siempre
 *   comparten el mismo HUB — hay ocasiones en que cada ruta combinada
 *   entrega a un DETTE/HUB distinto. La partición por remolque
 *   (_splitUnifiedBlocksByMarchamo) es una regla física de cómo WTMS
 *   imprime el documento (un remolque = una ruta, primero el bloque de
 *   la ruta con número mayor) que NO depende de si los destinos
 *   coinciden — por lo tanto se generaliza y se aplica siempre a
 *   cualquier ruta unificada, eliminando por completo la bifurcación
 *   sameDestino/no-sameDestino.
 *
 *   Algoritmo unificado (reemplaza ambas ramas anteriores):
 *     1. Se filtran los HUB de ruta alterna (ver FIX de arriba).
 *     2. Se dividen las filas restantes en exactamente 2 bloques por
 *        remolque (_splitUnifiedBlocksByMarchamo, con el mismo
 *        respaldo de corte por mitad si no se detectan exactamente 2).
 *     3. Se asignan los bloques a las rutas reales por magnitud
 *        numérica descendente (mismo criterio ya validado en ago-2026).
 *     4. NUEVO: dentro de CADA bloque ya asignado a su ruta real, se
 *        agrupa por `destino` — si el bloque trae un solo destino, el
 *        comportamiento es idéntico al de la rama sameDestino anterior
 *        (tarimas sumadas de todas sus facturas/invoices, un solo
 *        resultado); si el bloque trae destinos distintos (el caso que
 *        antes rompía), se genera una entrega independiente por cada
 *        destino, cada una con su propia ruta correcta.
 *   El agrupado por destino DENTRO de un bloque nunca cruza bloques —
 *   eso es justamente lo que garantiza que cada entrega quede asociada
 *   a la ruta real que le corresponde, sin importar si dos rutas
 *   combinadas comparten HUB o no.
 *
 *   _dedupeByDestino() deja de usarse en la rama de rutas unificadas
 *   (su semántica — "quedarse con la primera aparición, no sumar" —
 *   es para el caso distinto de un HUB físicamente repetido dentro de
 *   UNA sola entrega de ruta individual, ver FIX jul-2026 arriba). Se
 *   conserva sin cambios para esa rama.
 *
 * FIX (sep-2026) — segunda factura embebida en la línea de destino
 * pierde la entrega completa ("caso Ruta 1111, Entrega 6154000"):
 *   Caso real confirmado con EduarDo. Cuando una misma fila del PDF
 *   agrupa DOS facturas bajo una sola Secuencia (celda "Facturas" con
 *   texto envuelto en dos líneas, ej. "4659061458\n4659061457"), la
 *   línea de continuación que trae el destino (CONT_RE) queda con TRES
 *   tokens en vez de uno: destino + segunda factura + marchamo (ej.
 *   "4659 6154000 4659061457 144661"). CONT_RE solo toleraba como
 *   máximo UN token opcional después del destino — con dos tokens
 *   extra, el regex completo no matcheaba la línea, así que el bloque
 *   `if (cm) {...}` nunca se ejecutaba: `destino` se quedaba vacío
 *   (valor inicial `''`), y las líneas siguientes de marchamo tampoco
 *   se consumían (MARC_CANDIDATE_RE exige la línea completa en dígitos
 *   puros, y esta línea tiene espacios). Resultado: la entrega entera
 *   quedaba indexada con destino vacío en State.pdfData — no matcheaba
 *   contra el DETTE del Excel ni por factura de encabezado ni por
 *   destino, y el comparador informativo Excel-vs-PDF
 *   (features/source-check.js) reportaba un falso "faltante en PDF" +
 *   un falso "solo en PDF" (sin entrega) para la misma ruta.
 *
 *   Se extiende CONT_RE con un grupo opcional adicional para la
 *   segunda factura (exactamente 10 dígitos — un marchamo real nunca
 *   tiene más de 6, así que no hay ambigüedad posible con un marchamo
 *   genuino). Cuando aparece, se registra como un `rawRow` ADICIONAL
 *   (mismo destino, tarimas '0', sin marchamos propios — los
 *   marchamos del bloque son compartidos y se siguen acumulando en el
 *   row principal) y se empuja a `rawRows` DESPUÉS del row del
 *   encabezado — así _dedupeByDestino()/_groupBlockByDestino() (que ya
 *   existían) conservan factura/tarimas del encabezado (el dato
 *   correcto y completo) y solo consolidan destino + marchamos, sin
 *   perder la segunda factura por completo (queda disponible para
 *   diagnóstico y para un eventual match por factura contra el Excel).
 *   Validado contra los PDFs reales de las rutas 1111 (caso con el bug)
 *   y 1310 (fila con un solo token de continuación, sin segunda
 *   factura) — el segundo caso queda exactamente igual que antes.
 *
 * CAMBIO (Fase 0 — telemetría de citas no reconocidas, ago-2026):
 *   Antes, dentro de pdfExtract(), cualquier anotación FreeText cuyo
 *   texto no matcheara el regex de fecha se descartaba con un simple
 *   `continue` — sin ningún rastro de que existía texto que no se
 *   reconoció como cita. Esto hacía imposible saber, sin revisar PDFs
 *   uno por uno, qué formatos de captura está usando la operación que
 *   el detector actual no contempla.
 *
 *   Se agrega captura de esas anotaciones (NUEVO array `citaMisses`,
 *   devuelto por pdfExtract junto a `lines`/`annots`, sin afectarlos en
 *   absoluto) — el regex de detección de citas NO CAMBIA ni una línea:
 *   solo se agrega un `else` conceptual al `continue` existente, que
 *   antes no hacía nada. Cada candidato se reduce a su "firma de
 *   patrón" (_citaPatternSignature() — cada dígito se reemplaza por
 *   '#', preservando prefijos/sufijos/separadores literales) para que
 *   "CITA: 12/08/2026 06:00" y "CITA: 13/08/2026 07:30" cuenten como
 *   LA MISMA forma ("CITA: ##/##/#### ##:##"), no como dos incidencias
 *   distintas — el dato accionable es la FORMA del texto, no la fecha
 *   puntual que contiene.
 *
 *   parsePDF() asocia cada candidato a la(s) ruta(s) reales que
 *   comparten el destino físico más cercano (misma cascada de
 *   proximidad que ya usan las citas SÍ reconocidas — extraída a
 *   _nearestDestino() para no duplicar esa lógica dos veces) y expone
 *   el resultado en `unrecognizedCitas`. NO se escribe en `result`
 *   (las filas normales) — es un canal de diagnóstico completamente
 *   aparte, en paralelo.
 *
 *   Por eso el retorno de parsePDF() cambia de un array plano a
 *   `{ rows, unrecognizedCitas }` — el único caller (events.js →
 *   handlePDFs()) se actualiza en el mismo cambio para desestructurar
 *   `rows` en vez de iterar el valor de retorno directamente.
 *
 *   pdf.js sigue siendo puro — NO importa State, Supabase, ni
 *   IncidentStore. Solo devuelve el dato crudo; la sincronización con
 *   el Centro de Mantenimiento (features/incidents/) ocurre en
 *   events.js, igual que ya hace processors/merge.js con los misses de
 *   catálogo.
 *
 * FIX (sep-2026) — corrección de marchamos vía anotación de Edge
 * ("Agregar texto") + exclusión de la esquina de identificación:
 *   Caso real confirmado con EduarDo: cuando el marchamo impreso en el
 *   PDF viene vacío/incompleto para una entrega, el equipo usa la
 *   herramienta "Agregar texto" de Edge (NUNCA "Dibujar" — un trazo a
 *   mano alzada llega como anotación Ink, sin texto extraíble, eso NO
 *   sería viable sin OCR) para escribir el/los marchamo(s) correcto(s)
 *   directamente sobre el PDF, dentro del recuadro de la tabla de esa
 *   entrega. Esas anotaciones son del mismo subtipo FreeText que ya lee
 *   este archivo para las citas.
 *
 *   Antes de este fix, CUALQUIER FreeText sin fecha caía directo a
 *   `citaMisses` (telemetría del Centro de Mantenimiento) — la
 *   corrección del capturista nunca llegaba a `marchamos[]`. Ahora,
 *   dentro de la rama "no es cita" de pdfExtract(), se prueba PRIMERO
 *   si el texto tiene forma de lista de marchamos
 *   (_extractMarchamoAnnotation — exige que TODOS los tokens separados
 *   por salto de línea/coma/punto y coma pasen _isValidMarchamo(), lo
 *   que ya excluye por diseño anotaciones con letras o símbolos, como
 *   las de identificación de ruta/temperatura) antes de darla por
 *   perdida como cita-no-reconocida.
 *
 *   DECISIÓN DE FUSIÓN (confirmada con EduarDo): la anotación NUNCA
 *   reemplaza un marchamo ya detectado en la tabla impresa del PDF —
 *   se conserva lo impreso y se complementa con lo anotado, llenando
 *   primero cualquier posición vacía (hueco '' dejado por un marchamo
 *   inválido descartado) y agregando al final si no quedan huecos, sin
 *   exceder MAX_MARCH_SLOTS ni duplicar un valor ya presente — ver
 *   _mergeAnnotationMarchamos().
 *
 *   EXCLUSIÓN DE ZONA DE ENCABEZADO: confirmado con EduarDo que la
 *   esquina superior de la página 1 se usa exclusivamente para notas
 *   de identificación del documento (ruta, operador, certificados,
 *   tipo de mercancía — ej. "RUTA 3122\nADRIANA\nTIF", "TEMP -22°C"),
 *   nunca para datos de una entrega puntual. Aunque el filtro de
 *   contenido (_extractMarchamoAnnotation) ya descarta esas dos
 *   anotaciones de ejemplo por traer letras, se agrega una segunda
 *   barrera POR POSICIÓN (_inHeaderZone) como defensa adicional. Se
 *   aplica ÚNICAMENTE dentro de la rama "no es cita".
 *
 * FIX (sep-2026) — ancla de ENCABEZADO, no de continuación, para
 * asociar marchamos de anotación a su entrega ("caso Ruta 3122,
 * TIENDA 2289/2286 intercambiadas"):
 *   Un primer intento de corrección (ver historial de este archivo)
 *   asociaba cada anotación de marchamo por proximidad contra
 *   `tableRowPositions`, anclado a la posición de la LÍNEA DE
 *   CONTINUACIÓN (CONT_RE, ej. "4659 2289") que trae el destino. Se
 *   validó con el PDF real (3122.pdf) y el resultado fue incorrecto:
 *   las anotaciones se asignaron a la entrega VECINA (984 en vez de
 *   2289, 2289 en vez de 2286).
 *
 *   Causa raíz medida con datos reales (extracción fiel con
 *   pdfjsLib, misma versión que usa la app): el renglón de
 *   CONTINUACIÓN está entre 12 y 26pt MÁS ABAJO que el renglón de
 *   ENCABEZADO (ROW_RE) de la misma entrega — y es justo en el
 *   renglón de encabezado, no en el de continuación, donde vive
 *   visualmente la columna Marchamo (ahí es donde WTMS imprime
 *   valores como "66006", y donde el equipo pega su anotación al
 *   lado). Anclar contra la línea de continuación desplazaba el
 *   punto de referencia lo suficiente como para que la fila
 *   "vecina" (la anterior o la siguiente) quedara más cerca en
 *   distancia vertical que la fila real:
 *
 *     Fila 984  (encabezado) → y=377   Fila 984  (continuación) → y=389
 *     Fila 2289 (encabezado) → y=403   Fila 2289 (continuación) → y=415
 *     Fila 2286 (encabezado) → y=429   Fila 2286 (continuación) → y=441
 *
 *     Anotación "535054/387358" → y=396.8
 *       distancia a encabezado 2289 (403) = 6.2   ← correcto
 *       distancia a continuación 2289 (415) = 18.2
 *       distancia a continuación 984 (389) = 7.8  ← ganaba antes (INCORRECTO)
 *
 *     Anotación "535055/387359" → y=422.6
 *       distancia a encabezado 2286 (429) = 6.4   ← correcto
 *       distancia a continuación 2286 (441) = 18.4
 *       distancia a continuación 2289 (415) = 7.6 ← ganaba antes (INCORRECTO)
 *
 *   Se corrige guardando la posición de la línea de ENCABEZADO
 *   (capturada como `headerLine` justo antes de avanzar `i` hacia la
 *   línea de continuación) en `tableRowPositions`, en vez de la
 *   posición de la línea de continuación. Con este ancla, ambas
 *   anotaciones del caso real quedan a ~6pt de su fila correcta, muy
 *   por debajo de cualquier fila vecina (~19-33pt) — margen amplio,
 *   no un empate cerrado.
 *
 *   Deliberadamente SIN fallback a `destPositions` (bloques
 *   descriptivos "Entrega N ... Zona horaria") si `tableRowPositions`
 *   sale vacío — es preferible no aplicar ningún marchamo de
 *   anotación (la incidencia 'no_march' queda visible para revisión
 *   manual) a aplicarlo con un ancla que ya se demostró incorrecta
 *   dos veces.
 *
 *   Ningún otro comportamiento de pdf.js cambia. merge.js/constants.js
 *   no requieren ningún ajuste — siguen consumiendo `pdfRow.marchamos`
 *   exactamente igual, sin que les importe si un valor vino de la
 *   tabla impresa o de una anotación.
 *
 * Dependencia externa: pdfjsLib (cargado globalmente desde el CDN en
 * index.html, con su workerSrc ya configurado ahí). Este módulo no
 * configura el worker — eso es responsabilidad del bootstrap en index.html.
 *
 * Sin dependencias de State, DOM, ni otros módulos propios — son
 * funciones puras de transformación de datos. MAX_MARCH_SLOTS se
 * duplica localmente (mismo valor que MAX_MARCH en core/constants.js)
 * en vez de importarlo, para preservar esa independencia — pdf.js no
 * debe depender de ningún otro módulo propio.
 */

/** Máximo de marchamos por entrega — debe coincidir con MAX_MARCH (core/constants.js). */
const MAX_MARCH_SLOTS = 5;

/** Formato válido de marchamo: 5-6 dígitos, con o sin cero inicial. */
const MARC_RE = /^0?\d{5,6}$/;

/** Detección "candidata" de continuación de marchamo — más laxa que
 *  MARC_RE a propósito: solo sirve para decidir si una línea DEBE
 *  tratarse como un intento de marchamo (y por lo tanto seguir
 *  consumiéndola dentro del bloque de esta entrega) o no. La validez
 *  real del contenido se decide aparte con _isValidMarchamo(). */
const MARC_CANDIDATE_RE = /^\d{3,10}$/;

/** Valida el formato final de un marchamo ya extraído. @private */
function _isValidMarchamo(s) {
  return MARC_RE.test(String(s || '').trim());
}

/**
 * Formato válido de factura del CeDis: siempre 4659 + 6 dígitos (ej.
 * "4659060453"). NUEVO (ago-2026, Alcance B — falso positivo
 * 'dette_sin_pdf' por factura con typo de origen, ver nota de cabecera
 * "FIX (ago-2026) — factura con formato inválido no debe perder la
 * entrega completa" más arriba).
 */
const FACT_RE = /^4659\d{6}$/;

/** Valida el formato final de una factura ya extraída. @private */
function _isValidFactura(s) {
  return FACT_RE.test(String(s || '').trim());
}

/**
 * HUB de "ruta alterna" — NUEVO (sep-2026, ver nota de cabecera "FIX
 * (sep-2026) — HUBs de 'ruta alterna' generan falsos positivos").
 * WTMS agrega estos HUB como una "Entrega" de relleno cuando la carga
 * tomó alguna ruta alterna — NUNCA representan una entrega real, sin
 * importar el formato de la factura que traigan. Se filtran los
 * rawRows que apunten a cualquiera de estos destinos ANTES de calcular
 * destinos/bloques/dedupe, para ambas ramas de parsePDF (ruta
 * individual y ruta unificada).
 *
 * Confirmado con EduarDo — para agregar un HUB nuevo de este tipo en
 * el futuro: una entrada más en este Set, ninguna otra parte de este
 * archivo cambia.
 */
const IGNORED_ALT_ROUTE_DESTINOS = new Set(['29999138', '29999227', '29999230']);

/**
 * Zona de "encabezado administrativo" — NUEVO (sep-2026, ver nota de
 * cabecera "FIX (sep-2026) — corrección de marchamos vía anotación de
 * Edge... + exclusión de la esquina de identificación"). Anotaciones
 * FreeText dentro de esta región de la página se ignoran por completo
 * (ni marchamo ni citaMiss) — confirmado con EduarDo que esa zona se
 * usa exclusivamente para notas de identificación del documento (ruta,
 * operador, certificados, tipo de mercancía), nunca para datos de una
 * entrega puntual.
 *
 * yMaxRatio se expresa como fracción de la altura de la página (no en
 * puntos absolutos), para tolerar variación de tamaño de página entre
 * documentos. Tabla de configuración explícita — para ajustar el
 * alcance de la zona con más muestras reales, basta con cambiar esta
 * constante; _inHeaderZone() y sus llamadores no cambian.
 */
const HEADER_ZONE = { page: 1, yMaxRatio: 0.40 };

/**
 * @private
 * @param {number} pageNum
 * @param {number} y_td — posición vertical medida desde arriba de la página
 * @param {number} pageH — altura total de la página
 * @returns {boolean}
 */
function _inHeaderZone(pageNum, y_td, pageH) {
  return pageNum === HEADER_ZONE.page && y_td <= pageH * HEADER_ZONE.yMaxRatio;
}

/**
 * Reduce un texto de anotación a su "forma" — colapsa espacios y
 * reemplaza cada dígito por '#', preservando prefijos/sufijos/
 * separadores literales tal cual aparecen. NUEVO (Fase 0 — telemetría
 * de citas no reconocidas, ago-2026).
 *
 * Objetivo: agrupar anotaciones con la MISMA estructura de texto (ej.
 * "CITA: 12/08/2026 06:00" y "CITA: 15/08/2026 07:00 HRS" → firmas
 * "CITA: ##/##/#### ##:##" y "CITA: ##/##/#### ##:## HRS"
 * respectivamente) en una sola incidencia con su contador de
 * ocurrencias — en vez de una incidencia nueva por cada fecha/hora
 * literal, que sería ruido inmanejable. El límite de 80 caracteres
 * evita firmas absurdamente largas si una anotación trae texto
 * inusual (ej. un comentario largo mal usado como caja de cita).
 * @private
 * @param {string} text
 * @returns {string}
 */
function _citaPatternSignature(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\d/g, '#')
    .slice(0, 80);
}

/**
 * Encuentra el destino candidato más cercano a un ítem con posición
 * {pageNum, y_td} — misma cascada de fallback que ya usaba (inline) la
 * asignación de citas reconocidas: ventana de 300pt en la misma página
 * → misma página a cualquier distancia → página anterior → cualquier
 * posición del documento.
 *
 * NUEVO (Fase 0, ago-2026): se extrae como función compartida —
 * EXTRACCIÓN LITERAL del bloque que antes vivía inline dentro de
 * parsePDF() para las citas reconocidas, sin cambiar ni un operador de
 * esa lógica — para que la asignación de citas reconocidas y la de
 * `citaMisses` (no reconocidas) usen exactamente el mismo criterio de
 * proximidad, sin arriesgarse a que las dos implementaciones diverjan
 * con el tiempo. NUEVO (sep-2026): también la reutiliza la fusión de
 * marchamos por anotación de Edge — recibiendo `tableRowPositions` en
 * vez de `destPositions` (ver nota de cabecera "FIX (sep-2026) — ancla
 * de ENCABEZADO..."), la función en sí no cambia — es genérica sobre
 * cualquier lista de {destino,pageNum,y}.
 * @private
 * @param {{pageNum:number, y_td:number}} item
 * @param {Array<{destino:string,pageNum:number,y:number}>} destPositions
 * @returns {{destino:string,pageNum:number,y:number}|null}
 */
function _nearestDestino(item, destPositions) {
  let candidates = destPositions.filter(d => d.pageNum === item.pageNum && d.y <= item.y_td + 300);
  if (!candidates.length) candidates = destPositions.filter(d => d.pageNum === item.pageNum);
  if (!candidates.length) candidates = destPositions.filter(d => d.pageNum === item.pageNum - 1);
  if (!candidates.length) candidates = destPositions;
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => Math.abs(a.y - item.y_td) < Math.abs(b.y - item.y_td) ? a : b);
}

/**
 * Extrae todas las líneas de texto (agrupadas por posición vertical),
 * las anotaciones de tipo FreeText (citas de cada destino) reconocidas,
 * — NUEVO (Fase 0, ago-2026) — las anotaciones FreeText con texto que
 * NO matcheó el formato de fecha esperado (`citaMisses`), y — NUEVO
 * (sep-2026) — las anotaciones FreeText con forma de lista de
 * marchamos (`marchamoAnnots`, ver nota de cabecera "FIX (sep-2026) —
 * corrección de marchamos vía anotación de Edge"), de un PDF.
 *
 * @param {File} file
 * @returns {Promise<{
 *   lines: Array<{pageNum:number,y:number,text:string}>,
 *   annots: Array<{pageNum:number,y_td:number,cita:string}>,
 *   citaMisses: Array<{pageNum:number,y_td:number,signature:string}>,
 *   marchamoAnnots: Array<{pageNum:number,y_td:number,marchamos:string[]}>
 * }>}
 */
export async function pdfExtract(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const lines = [], annots = [], citaMisses = [], marchamoAnnots = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page  = await pdf.getPage(p);
    const vp    = page.getViewport({ scale: 1 });
    const pageH = vp.height;
    const tc    = await page.getTextContent();
    const byY   = new Map();

    for (const item of tc.items) {
      if (!item.str.trim()) continue;
      const y = Math.round(pageH - item.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push(item);
    }

    [...byY.keys()].sort((a, b) => a - b).forEach(y => {
      const text = byY.get(y)
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map(i => i.str.trim()).filter(Boolean).join(' ');
      if (text) lines.push({ pageNum: p, y, text });
    });

    const rawAnnots = await page.getAnnotations();
    for (const a of rawAnnots) {
      if (a.subtype !== 'FreeText') continue;
      let parts = [];
      if (Array.isArray(a.textContent) && a.textContent.length) {
        parts = a.textContent.map(s => String(s).trim()).filter(Boolean);
      } else {
        const plain = (a.contents || a.alternativeText || '').trim();
        if (plain) parts = [plain];
      }
      const allText   = parts.join(' ');
      const dateMatch = allText.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4})/);
      const timeMatch = allText.match(/(\d{1,2})[:.;]\s*(\d{2})(?![\/\-\d])/);
      if (!dateMatch) {
        const y_td = pageH - a.rect[3];

        // NUEVO (sep-2026 — exclusión de zona de encabezado): ver nota
        // de cabecera "FIX (sep-2026) — corrección de marchamos vía
        // anotación de Edge... + exclusión de la esquina de
        // identificación". Notas de identificación del documento
        // (ruta/operador/certificados/temperatura) nunca son marchamo
        // ni cita — se ignoran por completo, sin generar ninguna
        // incidencia de telemetría.
        if (_inHeaderZone(p, y_td, pageH)) continue;

        // NUEVO (sep-2026 — marchamos corregidos vía anotación de
        // Edge): se prueba PRIMERO si el texto tiene forma de lista de
        // marchamos antes de darlo por perdido como "cita no
        // reconocida" — mismo tipo de anotación (FreeText), dos
        // intenciones posibles del capturista.
        const marchList = _extractMarchamoAnnotation(allText);
        if (marchList) {
          marchamoAnnots.push({ pageNum: p, y_td, marchamos: marchList });
          continue;
        }

        // NUEVO (Fase 0 — telemetría de citas no reconocidas, ago-2026):
        // antes esta anotación se descartaba en silencio (`continue`),
        // sin dejar ningún rastro de que existía texto que no matcheó
        // el formato esperado. Se captura aquí — SIN bloquear ni
        // alterar el comportamiento existente (el `continue` sigue
        // ocurriendo exactamente igual después) — para que
        // Events.handlePDFs() pueda sincronizarla con el Centro de
        // Mantenimiento (features/incidents/) y darle visibilidad real
        // a qué formatos de cita no se están reconociendo hoy, antes
        // de decidir si vale la pena un catálogo de variantes completo.
        const trimmed = allText.trim();
        if (trimmed) {
          citaMisses.push({
            pageNum: p,
            y_td,
            signature: _citaPatternSignature(trimmed)
          });
        }
        continue;
      }
      const fecha = dateMatch[1].replace(/-/g, '/');
      let cita = fecha;
      if (timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        let m = parseInt(timeMatch[2], 10);
        m += 1;
        if (m >= 60) { m = 0; h += 1; }
        if (h >= 24) h = 0;
        cita = fecha + ' ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      }
      annots.push({ pageNum: p, y_td: pageH - a.rect[3], cita: cita.trim() });
    }
  }
  return { lines, annots, citaMisses, marchamoAnnots };
}

/**
 * Agrega un marchamo candidato a los arreglos de salida, validando su
 * formato de forma independiente al resto del bloque. Nunca lanza,
 * nunca reutiliza un valor de otra posición — si es inválido, deja la
 * posición vacía y registra el detalle crudo en `issues`.
 * @private
 * @param {string} raw — texto crudo capturado en esa posición
 * @param {string[]} marchamos — arreglo de salida (mutado in-place)
 * @param {Array<{raw:string}>} issues — arreglo de incidencias (mutado in-place)
 */
function _pushMarchamo(raw, marchamos, issues) {
  const val = String(raw || '').trim();
  if (!val) return; // posición no capturada — no es un "campo inválido", simplemente no había nada ahí
  if (_isValidMarchamo(val)) {
    marchamos.push(val);
  } else {
    marchamos.push('');
    issues.push({ raw: val });
  }
}

/**
 * Detecta si el texto de una anotación FreeText tiene "forma de lista
 * de marchamos" — NUEVO (sep-2026, ver nota de cabecera "FIX (sep-2026)
 * — corrección de marchamos vía anotación de Edge"). El equipo usa la
 * herramienta "Agregar texto" de Edge (nunca "Dibujar" — eso llegaría
 * como anotación Ink, sin texto extraíble) para escribir marchamos
 * corregidos directamente sobre el PDF cuando la tabla impresa viene
 * vacía o incompleta.
 *
 * Criterio: TODOS los tokens (separados por salto de línea, coma o
 * punto y coma) deben pasar _isValidMarchamo() — cualquier letra,
 * símbolo o separador de fecha ("/", "-") hace fallar el token
 * individual, así que anotaciones de otro tipo (ej.
 * "RUTA 3122\nADRIANA\nTIF", "TEMP -22°C") nunca se confunden con
 * esto. Se evalúa DESPUÉS del chequeo de fecha (dateMatch) en
 * pdfExtract() — una cita real nunca llega a probarse aquí.
 * @private
 * @param {string} text
 * @returns {string[]|null} lista de marchamos válidos, o null si el
 *   texto no tiene esa forma (algún token no pasa _isValidMarchamo)
 */
function _extractMarchamoAnnotation(text) {
  const tokens = String(text || '').trim().split(/[\s,;]+/).map(t => t.trim()).filter(Boolean);
  if (!tokens.length) return null;
  return tokens.every(t => _isValidMarchamo(t)) ? tokens : null;
}

/**
 * Fusiona marchamos de anotación de Edge con los ya extraídos de la
 * tabla impresa — NUEVO (sep-2026). Decisión confirmada con EduarDo: la
 * anotación NUNCA reemplaza un marchamo ya válido — se conserva lo
 * detectado y se complementa, ocupando primero cualquier posición
 * vacía (hueco '' dejado por un marchamo inválido descartado, ver
 * _pushMarchamo) y agregando al final si no quedan huecos, sin exceder
 * MAX_MARCH_SLOTS. Valores ya presentes se ignoran (no duplica).
 * @private
 * @param {string[]} marchamos — arreglo de salida (mutado in-place)
 * @param {string[]} values — marchamos detectados en la anotación
 * @returns {boolean} true si agregó al menos un valor nuevo
 */
function _mergeAnnotationMarchamos(marchamos, values) {
  let applied = false;
  for (const val of values) {
    if (marchamos.includes(val)) continue;
    if (marchamos.length >= MAX_MARCH_SLOTS) break;
    const emptyIdx = marchamos.indexOf('');
    if (emptyIdx !== -1) marchamos[emptyIdx] = val; else marchamos.push(val);
    applied = true;
  }
  return applied;
}

/**
 * Consolida bloques de PDF que repiten el mismo `destino` dentro de UNA
 * SOLA entrega física — caso real confirmado con EduarDo: un HUB que la
 * plataforma WTMS imprime varias veces en el mismo PDF, pero solo la
 * primera aparición trae marchamos; las repeticiones llegan sin ellos.
 *
 * Antes del fix "marchamo opcional" en ROW_RE (jul-2026), los bloques
 * repetidos SIN marchamo simplemente no matcheaban el regex — dedupe
 * implícito por diseño accidental. Ahora que el marchamo es opcional,
 * todos matchean y generan un rawRow independiente cada uno; sin este
 * consolidado, el último bloque (típicamente sin marchamos) pisaba en
 * State.pdfData al que sí los tenía (events.js → handlePDFs() indexa
 * por ruta+destino, último .set() gana) — falso positivo de "sin
 * marchamo principal" (regla SVE no_march).
 *
 * ÚNICO USO ACTUAL (sep-2026): la rama de ruta INDIVIDUAL de parsePDF()
 * — un HUB repetido en el PDF de una sola ruta es una sola entrega
 * real. Antes también se usaba en la rama "destinos distintos" de una
 * ruta unificada; esa rama se retiró (ver FIX (sep-2026) —
 * "generalización de rutas unificadas con destinos distintos" en la
 * cabecera del archivo) porque su semántica (quedarse con la PRIMERA
 * aparición sin sumar) es incorrecta para el caso de una ruta
 * unificada, donde varias filas con el mismo destino dentro de un
 * mismo bloque/remolque representan facturas/invoices DISTINTOS de una
 * misma entrega y deben sumarse, no deduplicarse — ver el agrupado
 * inline dentro de parsePDF() para ese caso.
 * @private
 * @param {Array<{destino:string, factura:string, tarimas:string, marchamos:string[], marchamoIssues:Array, facturaIssues:Array}>} list
 * @returns {Array<object>} misma forma, un elemento por destino único
 */
function _dedupeByDestino(list) {
  const byKey = new Map();
  const order = [];
  for (const r of list) {
    // Sin destino → nunca colisiona (Symbol único por entrada), no hay
    // nada que consolidar en ese caso.
    const key = r.destino || Symbol();
    if (!byKey.has(key)) {
      byKey.set(key, { ...r, marchamos: [...r.marchamos], marchamoIssues: [...r.marchamoIssues], facturaIssues: [...(r.facturaIssues || [])] });
      order.push(key);
      continue;
    }
    const existing = byKey.get(key);
    // Conserva factura/tarimas del primer bloque (idénticos entre
    // repeticiones del mismo HUB); toma los marchamos de cualquiera de
    // las repeticiones que sí los traiga. facturaIssues (NUEVO,
    // ago-2026) se concatena igual que marchamoIssues — diagnóstico
    // puramente informativo, nunca decide cuál factura "gana".
    if (!existing.marchamos.length && r.marchamos.length) existing.marchamos = [...r.marchamos];
    if (r.marchamoIssues.length) existing.marchamoIssues.push(...r.marchamoIssues);
    if (r.facturaIssues && r.facturaIssues.length) existing.facturaIssues.push(...r.facturaIssues);
  }
  return order.map(k => byKey.get(k));
}

/**
 * Divide rawRows de una ruta unificada en los bloques físicos reales
 * (uno por remolque) — ver nota de cabecera "FIX (ago-2026) — bug del
 * reparto desigual de marchamos" y su generalización en "FIX
 * (sep-2026) — generalización de rutas unificadas con destinos
 * distintos".
 *
 * WTMS solo imprime el marchamo en la PRIMERA fila de cada remolque —
 * el resto de filas del mismo remolque llegan sin marchamo propio. Esa
 * es la única señal fiable de "aquí empieza un bloque nuevo": se corta
 * cada vez que una fila (que no sea la primera del documento) trae su
 * propio marchamo válido o inválido (marchamos.length ||
 * marchamoIssues.length) — un marchamo con formato inválido sigue
 * siendo evidencia de que WTMS intentó imprimir uno ahí, así que
 * también cuenta como inicio de bloque.
 *
 * NOTA (sep-2026): esta función se aplica a TODA ruta unificada, sin
 * importar si ambas rutas comparten el mismo HUB destino o no — la
 * regla física (un remolque = una ruta) es independiente de esa
 * coincidencia. La bifurcación anterior por `sameDestino` se retiró.
 *
 * @private
 * @param {Array<{marchamos:string[], marchamoIssues:Array}>} rawRows
 * @returns {Array<Array<object>>} arreglo de bloques (cada bloque es un
 *   sub-arreglo contiguo de rawRows)
 */
function _splitUnifiedBlocksByMarchamo(rawRows) {
  const blocks = [];
  let current = [];
  rawRows.forEach((r, i) => {
    const hasOwnMarchamo = (r.marchamos && r.marchamos.length) || (r.marchamoIssues && r.marchamoIssues.length);
    if (i > 0 && hasOwnMarchamo) {
      blocks.push(current);
      current = [];
    }
    current.push(r);
  });
  if (current.length) blocks.push(current);
  return blocks;
}

/**
 * Agrupa las filas de UN bloque (ya asignado a su ruta real) por
 * `destino`, sumando tarimas/consolidando marchamos e issues DENTRO de
 * cada grupo — NUEVO (sep-2026, ver nota de cabecera "FIX (sep-2026) —
 * generalización de rutas unificadas con destinos distintos").
 *
 * A diferencia de _dedupeByDestino() (que conserva solo la PRIMERA
 * aparición sin sumar — pensada para un HUB literalmente repetido dos
 * veces por WTMS), aquí cada fila del bloque representa una
 * factura/invoice DISTINTA de una misma entrega física — todas las
 * filas que comparten destino dentro de este bloque deben sumarse
 * (mismo criterio que ya usaba, antes de esta generalización, el caso
 * sameDestino === true para el bloque completo).
 *
 * Si el bloque trae un único destino, el resultado es un solo grupo —
 * comportamiento idéntico al de la rama sameDestino anterior. Si trae
 * más de un destino (el caso que antes rompía, ruta unificada con
 * DETTE/HUB distintos por ruta), se genera un grupo independiente por
 * cada destino, cada uno destinado a convertirse en una entrega propia
 * con la ruta correcta ya resuelta por el caller.
 * @private
 * @param {Array<object>} blockRows — sub-arreglo contiguo de rawRows,
 *   ya asignado a una ruta real por el caller
 * @returns {Array<{destino:string, factura:string, tarimas:string,
 *   marchamos:string[], marchamoIssues:Array, facturaIssues:Array}>}
 */
function _groupBlockByDestino(blockRows) {
  const byDestino = new Map();
  const order = [];
  blockRows.forEach(r => {
    const key = r.destino || Symbol();
    if (!byDestino.has(key)) { byDestino.set(key, []); order.push(key); }
    byDestino.get(key).push(r);
  });
  return order.map(key => {
    const rows          = byDestino.get(key);
    const marchamos      = [...new Set(rows.flatMap(r => r.marchamos))];
    const marchamoIssues = rows.flatMap(r => r.marchamoIssues || []);
    // facturaIssues/factura — se toma del PRIMER row del grupo, mismo
    // criterio que ya usaba el caso sameDestino anterior: la factura
    // "representativa" de la entrega es la de su primer invoice.
    const facturaIssues = rows[0].facturaIssues || [];
    const tarimas = String(rows.reduce((s, r) => s + (parseInt(r.tarimas, 10) || 0), 0));
    return { destino: rows[0].destino, factura: rows[0].factura, tarimas, marchamos, marchamoIssues, facturaIssues };
  });
}

/**
 * Interpreta las líneas extraídas por pdfExtract() según el formato
 * específico de los PDFs de carga de Walmart CeDis, y produce las filas
 * estructuradas del documento más — NUEVO (Fase 0, ago-2026) — el
 * diagnóstico de citas no reconocidas.
 *
 * Maneja dos casos de nombre de archivo:
 *   - "12345.pdf"        → ruta única
 *   - "12345-67890.pdf"  → PDF unificado de dos rutas (se reparten
 *                            los destinos entre ambas — ver FIX
 *                            (sep-2026), generalización de destinos
 *                            distintos, en la cabecera del archivo)
 *
 * @param {{ lines: Array, annots: Array, citaMisses: Array, marchamoAnnots: Array }} extracted — salida de pdfExtract()
 * @param {string} filename — nombre original del archivo (para detectar ruta(s))
 * @returns {{
 *   rows: Array<{ ruta, operador, destino, factura, tarimas, marchamos,
 *                  marchamoIssues, facturaIssues, cita, hrDespacho }>,
 *   unrecognizedCitas: Array<{ ruta:string, destino:string, signature:string }>
 * }}
 *   rows.marchamoIssues: Array<{raw:string}> — marchamos candidatos
 *   detectados en el PDF que NO pasaron la validación de formato
 *   y por lo tanto quedaron vacíos en `marchamos` — consumido por
 *   features/validation/sve.js (regla 'bad_march') para reportar
 *   la incidencia con el valor crudo, sin bloquear ni afectar el
 *   resto de los campos de la misma entrega.
 *   rows.facturaIssues: Array<{raw:string}> — NUEVO (ago-2026, Alcance
 *   B). A diferencia de marchamoIssues, la factura NUNCA se vacía
 *   cuando el formato es inválido (ver nota de cabecera "FIX
 *   (ago-2026)") — se conserva intacta en `factura` para no romper el
 *   match contra el Excel. Consumido por sve.js (regla 'bad_fact',
 *   INFORMATIVA) puramente para diagnóstico.
 *   unrecognizedCitas: candidatos de cita (anotaciones FreeText) que
 *   NO matchearon el formato de fecha/hora esperado, agrupables por
 *   `signature` (patrón, no valor literal) — ver
 *   Events.handlePDFs() (events/events.js), que los sincroniza con
 *   el Centro de Mantenimiento (features/incidents/). NO afecta a
 *   `rows` de ninguna forma — es un canal de diagnóstico aparte.
 *
 *   NUEVO (sep-2026): `rows[].marchamos` ahora también puede incluir
 *   valores complementados desde una anotación de Edge (ver nota de
 *   cabecera "FIX (sep-2026) — corrección de marchamos vía anotación
 *   de Edge" y su corrección de ancla "FIX (sep-2026) — ancla de
 *   ENCABEZADO, no de continuación") — se fusionan al final, después
 *   de resolver las rutas unificadas/individuales, sin ningún campo
 *   nuevo expuesto en el objeto de retorno (el origen del valor no se
 *   distingue hacia afuera de este módulo).
 */
export function parsePDF({ lines, annots, citaMisses, marchamoAnnots }, filename) {
 const baseName     = filename.replace(/\.pdf$/i, '').replace(/^\d+_/, '');
const unifiedMatch = baseName.match(/^(\d+)-(\d+)$/);

// AJUSTE (ago-2026 — rutas divididas, "3215-1" no es ruta unificada):
// confirmado con EduarDo — cuando una ruta se "parte" en el día
// operativo, el sufijo tras el guión es un ÍNDICE corto (1, 2, 3…) del
// FRAGMENTO de la MISMA ruta física, no una segunda ruta combinada. El
// PDF y la columna RUTA de RUTEO NUEVO usan el nombre completo literal
// ("3215-1") como identificador. Antes, CUALQUIER "XXXX-YYYY" se
// interpretaba como combinada — "3215-1.pdf" se partía en rutas
// ["3215","1"], ninguna coincide con "3215-1" real → falso positivo de
// 'no_pdf' pese a que el PDF sí estaba cargado.
//
// Heurística: ruta COMBINADA real = dos números de magnitud comparable
// (ej. "1205-1206", 4 y 4 dígitos). Ruta DIVIDIDA = sufijo corto (≤2
// dígitos) y más corto que el número principal (ej. "3215-1": 4 vs 1).
const isSplitSuffix = !!unifiedMatch &&
  unifiedMatch[2].length <= 2 &&
  unifiedMatch[2].length < unifiedMatch[1].length;
const isUnified    = !!unifiedMatch && !isSplitSuffix;
const rutas        = isUnified ? [unifiedMatch[1], unifiedMatch[2]] : [baseName];

  let nombre = '', apellido = '', hrDespacho = '';
  for (const { text } of lines) {
    const nm = text.match(/^Nombre del Operador\s+(.+)$/i);   if (nm) nombre   = nm[1].trim();
    const am = text.match(/^Apellido del Operador\s+(.+)$/i); if (am) apellido = am[1].trim();
    if (!hrDespacho) {
      const fm = text.match(/Impreso\s*\/\s*enviado\s+por\s+fax\s+(\d{2}[-\/]\d{2}[-\/]\d{2,4})\s+(\d{2}:\d{2})/i);
      if (fm) {
        let rawDate = fm[1].replace(/-/g, '/');
        const pts = rawDate.split('/');
        if (pts[2] && pts[2].length === 2) pts[2] = '20' + pts[2];
        // FIX: el sello del PDF viene en formato inglés MM/DD/YYYY
        // (confirmado con muestra real: "07-26-2026" = 26 de julio de
        // 2026) — se invierte aquí a DD/MM/YYYY, que es la convención
        // que usa el resto de la app (normalizeAppointment/parseDateTime
        // en utils/date.js). NO tocar sin volver a verificar el formato
        // real del sello si cambia el proveedor/plantilla del PDF.
        hrDespacho = `${pts[1]}/${pts[0]}/${pts[2]} ${fm[2]}`;
      }
    }
  }
  const operador = (nombre + ' ' + apellido).trim();

  // Los grupos de factura/tarimas se validan por su propia forma —
  // independientes entre sí. El grupo de factura ahora captura
  // CUALQUIER corrida de 10 dígitos (antes exigía el prefijo "4659"
  // dentro del regex estructural) — ver nota de cabecera "FIX
  // (ago-2026) — factura con formato inválido no debe perder la
  // entrega completa": si el prefijo no coincidía, el regex COMPLETO
  // fallaba y la entrega entera desaparecía, aunque el resto de los
  // datos fueran válidos. La validación real de la factura (formato
  // 4659xxxxxx) se hace aparte, después de capturarla — ver
  // _isValidFactura()/facturaIssues más abajo, mismo criterio que ya
  // usa _pushMarchamo() para marchamos. El grupo del marchamo de
  // encabezado sigue siendo \S+ OPCIONAL — ver nota de cabecera "FIX
  // (jul-2026) — bug del marchamo ausente por completo".
  const ROW_RE  = /^CeDis\s+(?:TIENDA|HUB)\s+\S+\s+\d+\s+(\d{10})\s+(\d+)\s+\d+\s+\d+\s+\d+\s+[\d.]+(?:\s+(\S+))?$/;
  // CONT_RE — línea de continuación que trae el destino real (grupo 1).
  // FIX (sep-2026, ver nota de cabecera "segunda factura embebida"):
  // se agrega un grupo opcional intermedio para una SEGUNDA factura de
  // 10 dígitos que puede venir envuelta en la misma línea cuando dos
  // facturas comparten una sola Secuencia (ej. "4659 6154000
  // 4659061457 144661" — destino + segunda factura + marchamo). Se
  // exige \d{10} exacto para ese grupo — un marchamo real nunca tiene
  // más de 6 dígitos (ver MARC_RE), así que no hay ambigüedad posible.
  // El grupo del marchamo (ahora grupo 3) sigue siendo \S+ OPCIONAL,
  // sin cambios de criterio respecto a antes.
  const CONT_RE = /^4659\s+(\w+)(?:\s+(\d{10}))?(?:\s+(\S+))?$/;
  const STOP_RE = /^(Total de ordenes|Fin del informe|Walmart)/i;
  const DEST_RE = /^(?:TIENDA|HUB)\s+(\d+)\s+-\s+Zona horaria/i;

  const destPositions = [];
  for (const { pageNum, y, text } of lines) {
    const dm = text.match(DEST_RE);
    if (dm) destPositions.push({ destino: dm[1], pageNum, y });
  }

  const rawRows = [];
  // NUEVO (sep-2026 — FIX ancla de marchamos de anotación, ver nota de
  // cabecera "FIX (sep-2026) — ancla de ENCABEZADO, no de
  // continuación"): posición real (pageNum, y) del renglón de
  // ENCABEZADO (ROW_RE) de cada fila de la tabla de datos — donde
  // visualmente vive la columna Marchamo (ahí es donde WTMS imprime
  // valores como "66006" y donde el equipo pega su anotación al lado).
  // Se captura ANTES de avanzar a la línea de continuación (que trae el
  // destino, ~12-26pt más abajo) — medido y verificado contra un PDF
  // real: anclar a la línea de continuación desplaza el punto de
  // referencia lo suficiente para que la fila vecina gane la
  // comparación de proximidad. destPositions (arriba) sigue siendo el
  // ancla correcta para las citas — no se toca.
  const tableRowPositions = [];
  const textLines = lines.map(l => l.text);
  let i = 0;
  while (i < textLines.length) {
    const rm = textLines[i].match(ROW_RE);
    if (rm) {
      // FIX (ago-2026): ver nota de cabecera del archivo. El valor SÍ
      // se conserva aunque el formato sea inválido — a diferencia de
      // un marchamo inválido, vaciar la factura rompería el match
      // específico contra el Excel sin ganar nada a cambio. Solo se
      // registra el detalle crudo en facturaIssues para diagnóstico
      // (ver features/validation/sve.js, regla 'bad_fact').
      const facturaRaw = rm[1], tarimas = rm[2];
      const factura = facturaRaw;
      const facturaIssues = [];
      if (!_isValidFactura(facturaRaw)) facturaIssues.push({ raw: facturaRaw });

      const marchamos = [], marchamoIssues = [];

      // Marchamo de encabezado — validado de forma independiente,
      // nunca invalida factura/tarimas ya capturados arriba. rm[3]
      // puede venir undefined (grupo opcional) — _pushMarchamo() lo
      // maneja de forma segura (early return, no agrega nada).
      _pushMarchamo(rm[3], marchamos, marchamoIssues);

      let destino = '';
      // NUEVO (sep-2026) — se guarda la posición de ESTE renglón
      // (encabezado, ROW_RE) ANTES de avanzar i — ver nota de cabecera
      // "FIX (sep-2026) — ancla de ENCABEZADO...".
      const headerLine = lines[i];
      i++;
      // NUEVO (sep-2026) — ver nota de cabecera "segunda factura
      // embebida". Si la línea de continuación trae una segunda
      // factura (cm[2]), se guarda aparte para empujarla como rawRow
      // independiente DESPUÉS del row principal (más abajo) — nunca
      // antes, para que _dedupeByDestino()/_groupBlockByDestino()
      // conserven factura/tarimas del ENCABEZADO (el dato completo y
      // correcto de esta Secuencia), no los de la segunda factura.
      let extraFacturaRow = null;
      if (i < textLines.length) {
        const cm = textLines[i].match(CONT_RE);
        if (cm) {
          destino = cm[1];
          // CORREGIDO (sep-2026): ancla a headerLine (renglón de
          // encabezado), NO a lines[i] (línea de continuación) — ver
          // nota de cabecera "FIX (sep-2026) — ancla de ENCABEZADO...".
          tableRowPositions.push({ destino: cm[1], pageNum: headerLine.pageNum, y: headerLine.y });
          if (cm[2]) {
            const raw2 = cm[2];
            extraFacturaRow = {
              factura: raw2, tarimas: '0', marchamos: [], marchamoIssues: [],
              facturaIssues: _isValidFactura(raw2) ? [] : [{ raw: raw2 }],
              destino: cm[1]
            };
          }
          if (cm[3]) _pushMarchamo(cm[3], marchamos, marchamoIssues);
          i++;
        }
      }
      // Líneas de continuación con marchamos adicionales. Se usa un
      // detector "candidato" amplio (MARC_CANDIDATE_RE) para decidir
      // si la línea pertenece a este bloque de marchamos — la validez
      // real de cada una se decide aparte en _pushMarchamo(), así que
      // una línea con formato inválido NO corta la recolección de las
      // siguientes líneas válidas que vengan después.
      while (i < textLines.length && marchamos.length + marchamoIssues.length < MAX_MARCH_SLOTS) {
        const tl = textLines[i].trim();
        if (STOP_RE.test(tl)) break;
        if (MARC_CANDIDATE_RE.test(tl)) { _pushMarchamo(tl, marchamos, marchamoIssues); i++; }
        else break;
      }
      rawRows.push({ factura, tarimas, marchamos, marchamoIssues, facturaIssues, destino });
      // NUEVO (sep-2026): se empuja DESPUÉS del row principal — ver
      // comentario junto a la declaración de extraFacturaRow arriba.
      if (extraFacturaRow) rawRows.push(extraFacturaRow);
    } else i++;
  }

  // ── Filtro de HUBs de "ruta alterna" — NUEVO (sep-2026) ──
  // Ver nota de cabecera "FIX (sep-2026) — HUBs de 'ruta alterna'...".
  // Se aplica ANTES de cualquier otro cálculo (destinos, bloques por
  // remolque, dedupe) para ambas ramas (ruta individual y unificada) —
  // estos HUB nunca representan una entrega real, sin importar el
  // formato accidental de su factura.
  const filteredRawRows = rawRows.filter(r => !IGNORED_ALT_ROUTE_DESTINOS.has(r.destino));

  let result = [];
  if (isUnified) {
    // ── Generalizado (sep-2026) — ver nota de cabecera "FIX (sep-2026)
    // — generalización de rutas unificadas con destinos distintos".
    // Ya no se bifurca por sameDestino: SIEMPRE se divide por remolque
    // primero, luego se agrupa por destino DENTRO de cada bloque ya
    // asignado a su ruta real. Un bloque con un solo destino se
    // comporta igual que antes; un bloque con destinos distintos ahora
    // genera una entrega por cada uno, con la ruta correcta.
    const blocks = _splitUnifiedBlocksByMarchamo(filteredRawRows);
    let grupos;
    if (blocks.length === 2) {
      grupos = blocks;
    } else {
      // Respaldo — no se detectaron exactamente 2 bloques por
      // marchamo (ej. ninguna fila trae marchamo en absoluto, o un
      // patrón inesperado). Se conserva el corte por mitad como
      // antes — nunca peor que el comportamiento previo — con aviso
      // en consola para diagnóstico manual.
      console.warn(`[PDF] ${baseName}: se esperaban 2 bloques por remolque (detección por marchamo) pero se detectaron ${blocks.length} — usando corte por mitad como respaldo.`);
      const mid = Math.ceil(filteredRawRows.length / 2);
      grupos = [filteredRawRows.slice(0, mid), filteredRawRows.slice(mid)];
    }

    // Orden de asignación — confirmado con EduarDo (caso real
    // 1205-1206.pdf): WTMS imprime de arriba hacia abajo primero el
    // bloque de la ruta con número MAYOR, después el de número
    // MENOR. `rutas` conserva el orden literal del nombre del
    // archivo (no necesariamente ascendente), así que se ordena
    // explícitamente por valor numérico antes de repartir.
    const rutasPorMagnitud = [...rutas].sort((a, b) => parseInt(b, 10) - parseInt(a, 10));

    rutasPorMagnitud.forEach((ruta, idx) => {
      const grupo = grupos[idx] || [];
      if (!grupo.length) return;
      // NUEVO (sep-2026): un bloque puede traer una o más entregas
      // (destinos) reales — se agrupa por destino DENTRO del bloque ya
      // asignado a esta ruta (nunca a través de bloques distintos, eso
      // mezclaría datos de dos rutas). Ver _groupBlockByDestino().
      const entregas = _groupBlockByDestino(grupo);
      entregas.forEach(e => {
        result.push({ ruta, operador, destino: e.destino, factura: e.factura, tarimas: e.tarimas, marchamos: e.marchamos, marchamoIssues: e.marchamoIssues, facturaIssues: e.facturaIssues, cita: '', hrDespacho });
      });
    });
  } else {
    // NUEVO (jul-2026) — ruta individual: un HUB repetido físicamente en
    // el PDF es UNA sola entrega real — ver _dedupeByDestino(), nota de
    // cabecera "FIX (jul-2026) — falso positivo por HUB repetido".
    const deduped = _dedupeByDestino(filteredRawRows);
    for (const r of deduped) {
      result.push({ ruta: rutas[0], operador, destino: r.destino, factura: r.factura, tarimas: r.tarimas, marchamos: r.marchamos, marchamoIssues: r.marchamoIssues || [], facturaIssues: r.facturaIssues || [], cita: '', hrDespacho });
    }
  }

  if (annots.length && destPositions.length) {
    for (const ann of annots) {
      const best = _nearestDestino(ann, destPositions);
      if (!best) continue;
      const citaRows = result.filter(r => r.destino === best.destino && !r.cita);
      for (const row of citaRows) row.cita = ann.cita;
    }
  }

  // ── NUEVO (sep-2026 — corrección de marchamos vía anotación de
  // Edge) — ver nota de cabecera "FIX (sep-2026) — corrección de
  // marchamos..." y su corrección de ancla "FIX (sep-2026) — ancla de
  // ENCABEZADO...". Se aplica DESPUÉS de resolver rutas unificadas/
  // individuales, así que nunca interfiere con la partición por
  // remolque ni con el agrupado por destino. Usa `tableRowPositions`
  // (posición del renglón de ENCABEZADO), NO `destPositions` (bloques
  // descriptivos "Entrega N", lejos de donde el equipo anota) ni la
  // línea de continuación (verificado incorrecto contra un PDF real —
  // ver nota de cabecera) — deliberadamente SIN fallback a
  // destPositions si tableRowPositions sale vacío: mejor no aplicar
  // nada (incidencia 'no_march' visible para revisión) que aplicar con
  // un ancla que ya se demostró incorrecta. La fusión NUNCA reemplaza
  // un marchamo ya presente — ver _mergeAnnotationMarchamos().
  if (marchamoAnnots && marchamoAnnots.length && tableRowPositions.length) {
    for (const ma of marchamoAnnots) {
      const best = _nearestDestino(ma, tableRowPositions);
      if (!best) continue;
      const rows = result.filter(r => r.destino === best.destino);
      for (const row of rows) {
        _mergeAnnotationMarchamos(row.marchamos, ma.marchamos);
      }
    }
  }

  // ── NUEVO (Fase 0 — telemetría de citas no reconocidas, ago-2026) ──
  // Mismo criterio de proximidad que las citas reconocidas (arriba, vía
  // _nearestDestino), aplicado a los candidatos que NO pasaron el regex
  // de fecha/hora en pdfExtract(). Se asocia cada uno a la(s) ruta(s)
  // reales que comparten ese destino en `result` — si no hay ninguna
  // fila con ese destino (poco común, pero posible), se cae a `rutas`
  // (las rutas del archivo completo) para no perder el dato. Esto NO
  // toca `result` ni ningún campo de las filas ya construidas — es
  // puramente informativo, en paralelo.
  const unrecognizedCitas = [];
  if (citaMisses && citaMisses.length && destPositions.length) {
    for (const miss of citaMisses) {
      const best = _nearestDestino(miss, destPositions);
      if (!best) continue;
      const rutasAfectadas = [...new Set(result.filter(r => r.destino === best.destino).map(r => r.ruta))];
      unrecognizedCitas.push({
        ruta: rutasAfectadas.join(', ') || rutas.join(', '),
        destino: best.destino,
        signature: miss.signature
      });
    }
  }

  return { rows: result, unrecognizedCitas };
}
