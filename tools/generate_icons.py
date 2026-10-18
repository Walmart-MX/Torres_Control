"""
tools/generate_icons.py
Genera los iconos de la PWA (SmartDispatch) a partir de la paleta de
colores que ya vive en index.html (--navy / --amber). Un solo script,
una sola fuente de verdad para el set completo de iconos -- así si el
día de mañana cambia la marca, se corre de nuevo y listo (DRY).

CAMBIO (oct-2026 -- rediseño del icono): el monograma "SD" se
reemplaza por una silueta de camion de reparto. Motivos:
  1) La app YA usa un camion como marca de facto en el login y la
     topbar (ver index.html, brand-mark/modal-logo-mark) -- el icono
     instalado (lo que se ve en el escritorio/launcher) no coincidia
     con esa identidad visual, dos marcas distintas para la misma app.
  2) Un monograma de letras no dice nada del dominio (logistica/
     despacho) -- cualquier app podria usar "SD". Una silueta de
     camion se lee de un vistazo, sin texto.
  3) El sistema operativo YA pone el nombre de la app debajo del
     icono (launcher de Windows/Android) -- duplicar texto adentro del
     icono es redundante, por eso se elimina el monograma en vez de
     combinarlo con el camion.
Paleta sin cambios (navy/amber, mismas variables de siempre) y mismo
pipeline de tamaños/maskable -- solo cambia QUE se dibuja, no COMO se
empaqueta.

Uso:  python tools/generate_icons.py
Salida: icons/icon-192.png, icon-512.png, icon-maskable-512.png,
        apple-touch-icon.png (180), favicon.ico (16/32/48)
"""
import os
from PIL import Image, ImageDraw

NAVY = (11, 29, 51, 255)      # --navy
AMBER = (245, 166, 35, 255)   # --amber
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")


def _rounded_square(size, radius_pct):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * radius_pct)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=NAVY)
    return img, draw


def _draw_truck(draw, size, scale, offset_y=0.0):
    """
    Camion de reparto en vista lateral, en AMBER, mirando a la derecha
    (cabina adelante -- sugiere avance/despacho). Todo calculado como
    fraccion de `size`/`scale`, nada a mano -- para poder ajustar
    proporciones sin recalcular numeros sueltos.

    El centro (cx, cy) NO es el centro geometrico simple del icono: las
    lineas de velocidad pesan mas a la izquierda que la cabina a la
    derecha, y la caja pesa mas hacia arriba que las ruedas hacia abajo.
    Sin corregir eso, el conjunto queda descentrado a simple vista aun
    si esta "centrado" en el sentido de bounding-box. CX_CORR/CY_CORR
    son esa correccion, derivada a mano de las proporciones fijas de
    abajo (box_w/cab_w/largo de lineas para X; box_h/wheel_r para Y) --
    si se cambian esas proporciones, hay que re-derivarlas.

    @param scale: ancho total del camion como fraccion de `size` (0-1)
    @param offset_y: nudge vertical ADICIONAL, como fraccion de `size`
        (uso: ajuste fino del safe-zone del icono maskable, aparte del
        autocentrado que ya hace esta funcion)
    """
    W = size * scale
    H = W * 0.56  # camion bajo y ancho, nunca mas alto que ancho

    CX_CORR = W * 0.16    # el conjunto pesa 0.16W a la izquierda sin esta correccion
    CY_CORR = H * 0.155   # el conjunto pesa 0.155H hacia arriba sin esta correccion

    cx = size / 2 + CX_CORR
    cy = size / 2 + CY_CORR + size * offset_y

    box_w = W * 0.60     # caja de carga: 60% del ancho total
    cab_w = W * 0.30     # cabina: 30% (el 10% restante es el hueco entre ejes)
    box_h = H * 0.64
    cab_h = H * 0.46
    wheel_r = H * 0.17

    x0 = cx - W / 2
    body_bottom = cy + H * 0.08  # línea base de la carrocería, un poco bajo el centro -- deja aire para que las ruedas "cuelguen"
    box_top = body_bottom - box_h
    box_right = x0 + box_w
    cab_top = body_bottom - cab_h
    cab_right = box_right + cab_w

    # Líneas de velocidad -- 3 trazos cortos a la izquierda de la caja,
    # sugieren movimiento (el camion avanza hacia la derecha).
    line_h = H * 0.045
    gap = W * 0.06
    lengths = (W * 0.16, W * 0.12, W * 0.08)
    ys = (box_top + box_h * 0.22, box_top + box_h * 0.48, box_top + box_h * 0.74)
    for length, ly in zip(lengths, ys):
        x_end = x0 - gap
        draw.rounded_rectangle(
            [x_end - length, ly - line_h / 2, x_end, ly + line_h / 2],
            radius=line_h / 2, fill=AMBER
        )

    # Caja de carga
    draw.rounded_rectangle([x0, box_top, box_right, body_bottom], radius=H * 0.05, fill=AMBER)

    # Cabina -- parabrisas inclinado desde el techo de la caja hasta el frente del cofre
    draw.polygon([
        (box_right, cab_top),
        (cab_right, cab_top + cab_h * 0.42),
        (cab_right, body_bottom),
        (box_right, body_bottom),
    ], fill=AMBER)

    # Ruedas -- una bajo la caja, una bajo la cabina
    wheel_y = body_bottom
    for wx in (x0 + box_w * 0.30, cab_right - cab_w * 0.42):
        draw.ellipse([wx - wheel_r, wheel_y - wheel_r, wx + wheel_r, wheel_y + wheel_r], fill=AMBER)


def make_standard(size):
    img, draw = _rounded_square(size, radius_pct=0.22)
    _draw_truck(draw, size, scale=0.74)
    return img


def make_maskable(size):
    # Maskable: fondo a sangrado completo (sin esquinas redondeadas propias,
    # el OS hace su propio recorte) + contenido dentro de la "safe zone"
    # (círculo central del 80% del tamaño) para que no se corte feo.
    img = Image.new("RGBA", (size, size), NAVY)
    draw = ImageDraw.Draw(img)
    _draw_truck(draw, size, scale=0.52)
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    icon_192 = make_standard(192)
    icon_512 = make_standard(512)
    icon_maskable = make_maskable(512)
    apple_touch = make_standard(180)

    icon_192.save(os.path.join(OUT_DIR, "icon-192.png"))
    icon_512.save(os.path.join(OUT_DIR, "icon-512.png"))
    icon_maskable.save(os.path.join(OUT_DIR, "icon-maskable-512.png"))
    apple_touch.save(os.path.join(OUT_DIR, "apple-touch-icon.png"))

    # favicon.ico multi-resolución (16/32/48) a partir del de 192
    favicon_sizes = [(16, 16), (32, 32), (48, 48)]
    icon_192.save(
        os.path.join(OUT_DIR, "favicon.ico"),
        sizes=favicon_sizes,
    )

    print("Iconos generados en", os.path.abspath(OUT_DIR))


if __name__ == "__main__":
    main()
