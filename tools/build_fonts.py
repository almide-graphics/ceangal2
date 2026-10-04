#!/usr/bin/env python3
"""Build the bundled fonts in assets/fonts/ from upstream OFL sources.

Variable fonts are instanced to static Regular (and SemiBold for the UI
face), then subset:

  ui.ttf / ui-semibold.ttf   Inter          Latin, Latin-1, punctuation, symbols
  mono.ttf                    JetBrains Mono Latin, box drawing, arrows, symbols
  cjk.ttf                     Noto Sans JP   kana, CJK punctuation, fullwidth forms,
                                             every kanji in JIS X 0208 (cp932)

Usage (needs fonttools):  python3 tools/build_fonts.py <dir with upstream .ttf>
Upstream files: Inter[opsz,wght].ttf, JetBrainsMono[wght].ttf, NotoSansJP[wght].ttf
from https://github.com/google/fonts (ofl/inter, ofl/jetbrainsmono, ofl/notosansjp).
"""
import os
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "fonts")

LATIN = list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + [
    0x2010, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026, 0x2030,
    0x2039, 0x203A, 0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212, 0x2318,
    0x2325, 0x21E7, 0x23CE, 0x232B, 0x2713, 0x2715, 0x25B6, 0x25BC, 0x25B2, 0x25C0, 0x00D7,
]
MONO_EXTRA = list(range(0x2500, 0x2580)) + list(range(0x2190, 0x2200)) + list(range(0x2200, 0x2300))


def cjk_codepoints():
    cps = set(range(0x3000, 0x3100))          # CJK punctuation, hiragana, katakana
    cps |= set(range(0x31F0, 0x3200))         # katakana phonetic extensions
    cps |= set(range(0xFF00, 0xFFF0))         # fullwidth / halfwidth forms
    for cp in range(0x4E00, 0xA000):          # kanji present in JIS X 0208 / cp932
        try:
            chr(cp).encode("cp932")
            cps.add(cp)
        except UnicodeEncodeError:
            pass
    cps |= {0x2015, 0x2016, 0x2018, 0x2019, 0x201C, 0x201D, 0x2025, 0x2026, 0x203B, 0x2116, 0x2121, 0x25A0, 0x25A1, 0x25B2, 0x25B3, 0x25CB, 0x25CF, 0x25CE, 0x2605, 0x2606}
    return sorted(cps)


def build(src, dst, axes, unicodes, keep_layout=True):
    font = TTFont(src)
    if "fvar" in font:
        font = instancer.instantiateVariableFont(font, axes, updateFontNames=False)
    opts = subset.Options()
    opts.layout_features = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk"] if keep_layout else []
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = False
    s = subset.Subsetter(opts)
    s.populate(unicodes=unicodes)
    s.subset(font)
    font.save(dst)
    print(f"{os.path.relpath(dst, ROOT)}: {os.path.getsize(dst) // 1024} KiB, {font['maxp'].numGlyphs} glyphs")


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(OUT, exist_ok=True)
    build(os.path.join(src, "Inter[opsz,wght].ttf"), os.path.join(OUT, "ui.ttf"), {"wght": 400, "opsz": 14}, LATIN)
    build(os.path.join(src, "Inter[opsz,wght].ttf"), os.path.join(OUT, "ui-semibold.ttf"), {"wght": 600, "opsz": 14}, LATIN)
    build(os.path.join(src, "JetBrainsMono[wght].ttf"), os.path.join(OUT, "mono.ttf"), {"wght": 400}, LATIN + MONO_EXTRA, keep_layout=False)
    build(os.path.join(src, "NotoSansJP[wght].ttf"), os.path.join(OUT, "cjk.ttf"), {"wght": 400}, cjk_codepoints(), keep_layout=False)


if __name__ == "__main__":
    main()
