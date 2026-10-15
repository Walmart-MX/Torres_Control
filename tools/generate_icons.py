"""
tools/generate_icons.py
Genera los iconos de la PWA (SmartDispatch) a partir de la paleta de
colores que ya vive en index.html (--navy / --amber). Un solo script,
una sola fuente de verdad para el set completo de iconos — así si el
día de mañana cambia la marca, se corre de nuevo y listo (DRY).

Uso:  python tools/generate_icons.py
Salida: icons/icon-192.png, icon-512.png, icon-maskable-512.png,
        apple-touch-icon.png (180), favicon.ico (16/32/48)
"""
import os
from PIL import Image, ImageDraw, ImageFont

NAVY = (11, 29, 51, 255)      # --navy
AMBER = (245, 166, 35, 255)   # --amber
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "icons")

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
]


def _font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _rounded_square(size, radius_pct):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * radius_pct)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=NAVY)
    return img, draw


def _draw_monogram(draw, size, scale):
    """'SD' en amber, centrado, tamaño proporcional a `scale` (0-1)."""
    font = _font(int(size * scale))
    text = "SD"
    bbox = draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pos = ((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1])
    draw.text(pos, text, font=font, fill=AMBER)


def make_standard(size):
    img, draw = _rounded_square(size, radius_pct=0.22)
    _draw_monogram(draw, size, scale=0.46)
    return img


def make_maskable(size):
    # Maskable: fondo a sangrado completo (sin esquinas redondeadas propias,
    # el OS hace su propio recorte) + contenido dentro de la "safe zone"
    # (círculo central del 80% del tamaño) para que no se corte feo.
    img = Image.new("RGBA", (size, size), NAVY)
    draw = ImageDraw.Draw(img)
    _draw_monogram(draw, size, scale=0.34)
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
