#!/usr/bin/env python3
"""Every icon and logo the apps and stores need, from the Almide v2 brand.

Sources, in store/brand/ (from almide/almide docs/assets/brand and
almide/playground web/; the SVGs are the masters, the PNGs are Chrome
renders of them at 2048 / 2400 px):
  almide-symbol(-white|-dark).svg / -2048.png   the armadillo mark
  almide-logo-horizontal-dark.svg / -2400.png   mark + wordmark, for dark grounds
  favicon.svg                                   the web favicon (dark-mode aware)

The app icon matches almide/playground's: the mark in colour, 72% wide,
centred on white. The brand guideline forbids recolouring the shell, so it
is only ever scaled.

  python3 tools/build_brand.py

Writes (all committed):
  store/playground/icon-1024.png          master (no alpha: App Store, Play)
  store/playground/play-icon-512.png      Google Play listing icon
  store/playground/feature-graphic.png    Google Play feature graphic 1024x500
  store/playground/android/*-<dpi>.png    adaptive icon layers
  store/playground/macos/AppIcon.icns     macOS (rounded tile, Big Sur grid)
  store/playground/ios/AppIcon-1024.png   iOS single-size app icon
  store/playground/windows/*.png          MSIX tile and logo assets
  store/playground/linux/<n>x<n>.png      hicolor icons
  store/playground/web/*                  favicon, PWA icons, apple-touch-icon
  apps/playground/assets/brand/logo(-dark).rgba  header marks (u16 w, u16 h, RGBA)
Needs Pillow; the .icns step needs macOS `iconutil` (skipped elsewhere).
"""
import os
import shutil
import struct
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = os.path.join(ROOT, "store/brand")
OUT = os.path.join(ROOT, "store/playground")

WHITE = (255, 255, 255)
NAVY_DEEP = (11, 20, 32)   # --bg-deep
TEAL = (20, 162, 162)      # --accent-light


def symbol(variant=""):
    im = Image.open(os.path.join(BRAND, f"almide-symbol{variant}-2048.png")).convert("RGBA")
    return im.crop(im.getbbox())


def place(canvas, mark, frac, cx=0.5, cy=0.5):
    """Paste `mark` scaled to `frac` of the canvas width, centred at (cx, cy)."""
    w = round(canvas.width * frac)
    h = round(mark.height * w / mark.width)
    m = mark.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(m, (round(canvas.width * cx - w / 2), round(canvas.height * cy - h / 2)))
    return canvas


def full_icon(size, bg=WHITE, frac=0.72):
    """Square, full bleed: the playground's icon (iOS, Play, Windows plates)."""
    return place(Image.new("RGBA", (size, size), bg + (255,)), symbol(), frac).convert("RGB")


def rounded_tile(size, inset, radius, frac=0.72):
    """macOS / Linux style: a white rounded square with a soft shadow."""
    tile = full_icon(size - 2 * inset, frac=frac)
    mask = Image.new("L", tile.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, tile.width - 1, tile.height - 1), radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sm = Image.new("L", (size, size), 0)
    off = size * 0.01
    ImageDraw.Draw(sm).rounded_rectangle((inset, inset + off, size - inset, size - inset + off), radius, fill=90)
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow.putalpha(sm.filter(ImageFilter.GaussianBlur(size * 0.012)))
    out.alpha_composite(shadow)
    out.paste(tile, (inset, inset), mask)
    return out


def save(img, *parts):
    path = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    return path


def main():
    for d in ("android", "windows", "linux", "web", "macos", "ios"):
        shutil.rmtree(os.path.join(OUT, d), ignore_errors=True)

    master = full_icon(1024)
    save(master, "icon-1024.png")
    save(master, "ios", "AppIcon-1024.png")
    save(full_icon(512), "play-icon-512.png")

    # Play feature graphic: the horizontal logo on the brand's dark ground,
    # with the teal light of almide/almide's cover.
    fg = Image.new("RGBA", (1024, 500), NAVY_DEEP + (255,))
    glow = Image.new("RGBA", fg.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).polygon([(60, 0), (330, 0), (560, 500), (290, 500)], fill=TEAL + (34,))
    ImageDraw.Draw(glow).polygon([(-120, 0), (40, 0), (270, 500), (110, 500)], fill=TEAL + (22,))
    fg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(2)))
    logo = Image.open(os.path.join(BRAND, "almide-logo-horizontal-dark-2400.png")).convert("RGBA")
    place(fg, logo, 0.68)
    save(fg.convert("RGB"), "feature-graphic.png")

    # Android adaptive icon: white background layer (a colour, see
    # build_android.sh), the mark as the foreground inside the 66/108 safe
    # zone, and its silhouette as the themed-icon (monochrome) layer.
    for dpi, px in {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}.items():
        save(place(Image.new("RGBA", (px, px), (0, 0, 0, 0)), symbol(), 0.54), "android", f"fg-{dpi}.png")
        save(place(Image.new("RGBA", (px, px), (0, 0, 0, 0)), symbol("-white"), 0.54), "android", f"mono-{dpi}.png")

    # macOS: Big Sur grid (824 px tile in 1024, radius ~185).
    with tempfile.TemporaryDirectory() as d:
        iconset = os.path.join(d, "AppIcon.iconset")
        os.makedirs(iconset)
        big = rounded_tile(1024, 100, 185, frac=0.70)
        for s in (16, 32, 128, 256, 512):
            big.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}.png"))
            big.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))
        save(big, "macos", "icon-1024.png")
        if shutil.which("iconutil"):
            subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(OUT, "macos/AppIcon.icns")], check=True)

    # Windows MSIX: white plates (scale-200) + unplated marks for the taskbar.
    def plate(w, h, frac):
        return place(Image.new("RGBA", (w, h), WHITE + (255,)), symbol(), frac * h / w).convert("RGB")
    save(plate(88, 88, 0.80), "windows", "Square44x44Logo.scale-200.png")
    save(plate(300, 300, 0.62), "windows", "Square150x150Logo.scale-200.png")
    save(plate(620, 300, 0.62), "windows", "Wide310x150Logo.scale-200.png")
    save(plate(100, 100, 0.80), "windows", "StoreLogo.scale-200.png")
    for s in (16, 24, 32, 48, 256):
        save(place(Image.new("RGBA", (s, s), (0, 0, 0, 0)), symbol(), 0.94), "windows", f"Square44x44Logo.targetsize-{s}_altform-unplated.png")

    # Linux (hicolor) and web.
    for s in (64, 128, 256, 512):
        save(rounded_tile(s, round(s * 0.06), round(s * 0.2)), "linux", f"{s}x{s}.png")
    save(full_icon(512), "web", "icon-512.png")
    save(full_icon(192), "web", "icon-192.png")
    save(full_icon(180, frac=0.76), "web", "apple-touch-icon.png")
    save(place(Image.new("RGBA", (64, 64), (0, 0, 0, 0)), symbol(), 1.0), "web", "favicon.png")
    shutil.copy(os.path.join(BRAND, "favicon.svg"), os.path.join(OUT, "web", "favicon.svg"))

    # The header marks, shown as delivered, 3x of 28 px: the colour mark on
    # the light header, the dark-ground variant (light tail) on the dark one.
    for variant, name in (("", "logo.rgba"), ("-dark", "logo-dark.rgba")):
        logo = symbol(variant)
        logo.thumbnail((84, 84), Image.LANCZOS)
        dst = os.path.join(ROOT, "apps/playground/assets/brand", name)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(struct.pack(">HH", logo.width, logo.height) + logo.tobytes())
    print("brand assets written")


if __name__ == "__main__":
    main()
