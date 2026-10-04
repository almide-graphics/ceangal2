#!/usr/bin/env python3
"""Every icon and logo the apps and stores need, from one source.

Sources: store/brand/almide-icon-512.png (almide/playground's app icon, the
canonical one), store/brand/almide-mark.png (the bare "A" from almide/docs,
for the Android themed-icon layer) and store/brand/almide-mark-header.png
(the bare "A" with red edges, almide/playground's header mark). Sizes above 512 are Lanczos
upscales; a 1024 master from the designer can replace the icon file.

  python3 tools/build_brand.py

Writes (all committed):
  store/playground/icon-1024.png          master (no alpha: App Store, Play)
  store/playground/play-icon-512.png      Google Play listing icon
  store/playground/feature-graphic.png    Google Play feature graphic 1024x500
  store/playground/android/fg-<dpi>.png   adaptive icon foreground layers
  store/playground/macos/AppIcon.icns     macOS (rounded tile, Big Sur grid)
  store/playground/ios/AppIcon-1024.png   iOS single-size app icon
  store/playground/windows/*.png          MSIX tile and logo assets
  store/playground/linux/<n>x<n>.png      hicolor icons
  store/playground/web/*.png              favicon, PWA icons, apple-touch-icon
  apps/playground/assets/brand/logo.rgba  the header mark (u16 w, u16 h, RGBA)
Needs Pillow; the .icns step needs macOS `iconutil` (skipped elsewhere).
"""
import os
import shutil
import struct
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "store/brand/almide-mark.png")
ICON = os.path.join(ROOT, "store/brand/almide-icon-512.png")
OUT = os.path.join(ROOT, "store/playground")

BG_CENTER = (33, 33, 54)   # sampled from almide/playground's icon-512.png
BG_EDGE = (20, 20, 26)
ACCENT = (124, 92, 191)    # --accent


def mark():
    return Image.open(SRC).convert("RGBA")


def gradient(w, h, cx=0.5, cy=0.47):
    """Radial gradient, centre colour at (cx, cy), edge colour at the corners."""
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            dx, dy = x / 63 - cx, y / 63 - cy
            t = min(1.0, (dx * dx + dy * dy) ** 0.5 / 0.75)
            t = t * t * (3 - 2 * t)
            px[x, y] = tuple(round(c + (e - c) * t) for c, e in zip(BG_CENTER, BG_EDGE))
    return small.resize((w, h), Image.BICUBIC).filter(ImageFilter.GaussianBlur(max(w, h) / 200))


def place(canvas, frac, cy=0.47):
    """Paste the mark scaled to `frac` of the canvas width, centred at cy."""
    m = mark()
    w = round(canvas.width * frac)
    h = round(m.height * w / m.width)
    m = m.resize((w, h), Image.LANCZOS)
    x = (canvas.width - w) // 2
    y = round(canvas.height * cy - h / 2)
    canvas.alpha_composite(m, (x, y)) if canvas.mode == "RGBA" else canvas.paste(m, (x, y), m)
    return canvas


def full_icon(size):
    """Square, full bleed (iOS, Play, Android legacy, Windows store logo)."""
    im = Image.open(ICON).convert("RGB").resize((size, size), Image.LANCZOS)
    return im.filter(ImageFilter.UnsharpMask(1.2, 60, 2)) if size > 512 else im


def icon_on(w, h, frac):
    """The icon's mark area, feathered onto the matching gradient (wide tiles)."""
    canvas = gradient(w, h).convert("RGBA")
    s = round(h * frac / 0.47)
    ic = full_icon(s).convert("RGBA")
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).ellipse((s * 0.12, s * 0.08, s * 0.88, s * 0.84), fill=255)
    ic.putalpha(mask.filter(ImageFilter.GaussianBlur(s * 0.06)))
    canvas.alpha_composite(ic, ((w - s) // 2, (h - s) // 2))
    return canvas.convert("RGB")


def rounded_tile(size, inset, radius):
    """macOS-style tile: rounded square with a soft shadow on transparency."""
    tile = full_icon(size - 2 * inset)
    mask = Image.new("L", tile.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, tile.width - 1, tile.height - 1), radius, fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    sm = Image.new("L", (size, size), 0)
    ImageDraw.Draw(sm).rounded_rectangle((inset, inset + size * 0.01, size - inset, size - inset + size * 0.01), radius, fill=110)
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
    master = full_icon(1024)
    save(master, "icon-1024.png")
    save(master, "ios", "AppIcon-1024.png")
    save(full_icon(512), "play-icon-512.png")

    # Play feature graphic: the mark left of centre (text goes in the listing).
    fg = gradient(1024, 500, cx=0.3, cy=0.5).convert("RGBA")
    s = 560
    ic = full_icon(s).convert("RGBA")
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).ellipse((s * 0.12, s * 0.08, s * 0.88, s * 0.84), fill=255)
    ic.putalpha(mask.filter(ImageFilter.GaussianBlur(s * 0.06)))
    fg.alpha_composite(ic, (round(1024 * 0.3 - s / 2), (500 - s) // 2))
    glow = Image.new("RGBA", fg.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((560, 120, 1000, 380), fill=ACCENT + (60,))
    fg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(80)))
    save(fg.convert("RGB"), "feature-graphic.png")

    # Android adaptive icon: the whole icon is the background layer (its mark,
    # 47% wide, sits inside the 66/108 safe zone); the foreground is empty
    # and the monochrome (themed) layer is the bare mark.
    for dpi, px in {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}.items():
        save(full_icon(px), "android", f"bg-{dpi}.png")
        layer = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        save(place(layer, 0.42, cy=0.48), "android", f"mono-{dpi}.png")

    # macOS: Big Sur grid (824 px tile in 1024, radius ~185).
    with tempfile.TemporaryDirectory() as d:
        iconset = os.path.join(d, "AppIcon.iconset")
        os.makedirs(iconset)
        big = rounded_tile(1024, 100, 185)
        for s in (16, 32, 128, 256, 512):
            big.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}.png"))
            big.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))
        save(big, "macos", "icon-1024.png")
        if shutil.which("iconutil"):
            os.makedirs(os.path.join(OUT, "macos"), exist_ok=True)
            subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(OUT, "macos/AppIcon.icns")], check=True)

    # Windows MSIX (scale-200 assets + unplated target sizes for the taskbar).
    save(icon_on(88, 88, 0.62), "windows", "Square44x44Logo.scale-200.png")
    save(icon_on(300, 300, 0.5), "windows", "Square150x150Logo.scale-200.png")
    save(icon_on(620, 300, 0.5), "windows", "Wide310x150Logo.scale-200.png")
    save(icon_on(100, 100, 0.62), "windows", "StoreLogo.scale-200.png")
    for s in (16, 24, 32, 48, 256):
        layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        save(place(layer, 0.86, cy=0.5), "windows", f"Square44x44Logo.targetsize-{s}_altform-unplated.png")

    # Linux (hicolor) and web.
    for s in (64, 128, 256, 512):
        save(rounded_tile(s, round(s * 0.06), round(s * 0.2)), "linux", f"{s}x{s}.png")
    save(full_icon(512), "web", "icon-512.png")
    save(full_icon(192), "web", "icon-192.png")
    save(full_icon(180), "web", "apple-touch-icon.png")
    save(rounded_tile(64, 2, 12), "web", "favicon.png")

    # The header mark: the bare "A" with its red edges (almide/playground's
    # almide.svg; store/brand/almide-mark-header.png), 3x of 28 px.
    logo = Image.open(os.path.join(ROOT, "store/brand/almide-mark-header.png")).convert("RGBA")
    logo.thumbnail((84, 84), Image.LANCZOS)
    dst = os.path.join(ROOT, "apps/playground/assets/brand/logo.rgba")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst, "wb") as f:
        f.write(struct.pack(">HH", logo.width, logo.height) + logo.tobytes())
    print("brand assets written")


if __name__ == "__main__":
    main()
