#!/usr/bin/env python3
"""Every platform's icons for an app, from one picture (docs/adr/0006).

    ceangal icons                       (or: python3 tools/app_icons.py)

Reads the app's settings from the environment (`ceangal env`): APP_ICON, a
1024 px square PNG drawn edge to edge (no rounded corners, the platforms
add their own), and APP_ICON_BG for the grounds. Without APP_ICON the icon
is the app name's initial on APP_ICON_BG. Writes, under APP_STORE (commit
them, as the playground does):

  icon-1024.png  play-icon-512.png  ios/AppIcon-1024.png
  android/fg-<dpi>.png               adaptive icon foreground (full bleed)
  macos/AppIcon.icns  macos/icon-1024.png
  windows/*.png                       MSIX tiles (scale 100 and 200, unplated)
  linux/icons/<n>x<n>.png  web/{icon-192,icon-512,apple-touch-icon,favicon}.png

Existing files are kept unless --force: an app may replace any of them by
hand (the playground's come from tools/build_brand.py). Needs Pillow; the
.icns needs macOS `iconutil` (skipped elsewhere).
"""
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SDK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORCE = "--force" in sys.argv


def env(k, default=""):
    v = os.environ.get(k, default)
    return v if v else default


OUT = env("APP_STORE")
if not OUT:
    sys.exit("app_icons.py: APP_STORE is not set (run it as `ceangal icons`)")


def rgb(hexstr):
    h = hexstr.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) if len(h) == 6 else (255, 255, 255)


BG = rgb(env("APP_ICON_BG", "#FFFFFF"))


def initial_icon():
    """The app name's initial, white (or black on a light ground), centred."""
    im = Image.new("RGBA", (1024, 1024), BG + (255,))
    letter = (env("APP_NAME", "A").strip() or "A")[0].upper()
    light = sum(BG) / 3 > 170
    font = ImageFont.truetype(os.path.join(SDK, "assets/fonts/ui-semibold.ttf"), 600)
    d = ImageDraw.Draw(im)
    l, t, r, b = d.textbbox((0, 0), letter, font=font)
    d.text(((1024 - (r - l)) / 2 - l, (1024 - (b - t)) / 2 - t), letter, font=font,
           fill=(20, 20, 20) if light else (255, 255, 255))
    return im


def master():
    p = env("APP_ICON")
    if p and os.path.exists(p):
        im = Image.open(p).convert("RGBA")
        side = min(im.size)
        im = im.crop(((im.width - side) // 2, (im.height - side) // 2,
                      (im.width + side) // 2, (im.height + side) // 2))
        ground = Image.new("RGBA", im.size, BG + (255,))
        ground.alpha_composite(im)
        return ground.resize((1024, 1024), Image.LANCZOS)
    return initial_icon()


MASTER = master()


def icon(size):
    return MASTER.resize((size, size), Image.LANCZOS)


def rounded_tile(size, inset, radius):
    """macOS / Linux style: the icon as a rounded square with a soft shadow."""
    tile = icon(size - 2 * inset)
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


def plate(w, h):
    """A Windows tile: the icon centred on its ground colour."""
    side = round(min(w, h) * 0.8)
    out = Image.new("RGBA", (w, h), BG + (255,))
    out.alpha_composite(icon(side), ((w - side) // 2, (h - side) // 2))
    return out.convert("RGB")


written = []


def save(img, *parts):
    path = os.path.join(OUT, *parts)
    if os.path.exists(path) and not FORCE:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    written.append(os.path.relpath(path, OUT))


def main():
    save(icon(1024).convert("RGB"), "icon-1024.png")
    save(icon(1024).convert("RGB"), "ios", "AppIcon-1024.png")
    save(icon(512).convert("RGB"), "play-icon-512.png")

    # Android adaptive icon: the picture full bleed as the foreground layer
    # (the launcher masks it to its shape), APP_ICON_BG behind it.
    for dpi, px in {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}.items():
        save(icon(px), "android", f"fg-{dpi}.png")

    # macOS: Big Sur grid (824 px tile in 1024, radius ~185).
    big = rounded_tile(1024, 100, 185)
    save(big, "macos", "icon-1024.png")
    icns = os.path.join(OUT, "macos", "AppIcon.icns")
    if shutil.which("iconutil") and (FORCE or not os.path.exists(icns)):
        with tempfile.TemporaryDirectory() as d:
            iconset = os.path.join(d, "AppIcon.iconset")
            os.makedirs(iconset)
            for s in (16, 32, 128, 256, 512):
                big.resize((s, s), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}.png"))
                big.resize((s * 2, s * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))
            subprocess.run(["iconutil", "-c", "icns", iconset, "-o", icns], check=True)
            written.append("macos/AppIcon.icns")

    # Windows MSIX: plates at scale 100 (what the default resources.pri
    # resolves to) and 200, and the unplated taskbar icons.
    for k in (1, 2):
        save(plate(44 * k, 44 * k), "windows", f"Square44x44Logo.scale-{k * 100}.png")
        save(plate(150 * k, 150 * k), "windows", f"Square150x150Logo.scale-{k * 100}.png")
        save(plate(310 * k, 150 * k), "windows", f"Wide310x150Logo.scale-{k * 100}.png")
        save(plate(50 * k, 50 * k), "windows", f"StoreLogo.scale-{k * 100}.png")
    for s in (16, 24, 32, 48, 256):
        save(rounded_tile(s, 0, round(s * 0.2)), "windows", f"Square44x44Logo.targetsize-{s}_altform-unplated.png")

    # Linux (hicolor) and web.
    for s in (64, 128, 256, 512):
        save(rounded_tile(s, round(s * 0.06), round(s * 0.2)), "linux", "icons", f"{s}x{s}.png")
    save(icon(512).convert("RGB"), "web", "icon-512.png")
    save(icon(192).convert("RGB"), "web", "icon-192.png")
    save(icon(180).convert("RGB"), "web", "apple-touch-icon.png")
    save(rounded_tile(64, 0, 14), "web", "favicon.png")
    print(f"icons: {len(written)} written under {OUT}" + ("" if written else " (all present; --force remakes them)"))


if __name__ == "__main__":
    main()
