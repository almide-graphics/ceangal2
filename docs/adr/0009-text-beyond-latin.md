# ADR 0009 — Text beyond Latin: per-script fonts, joining and bidi without OpenType shaping

## Context
ceangal drew text with Inter (Latin only), JetBrains Mono and a Japanese
CJK font, through its own TrueType parser and rasteriser (snaidhm.font):
glyph lookup by cmap and advance widths, with no GSUB/GPOS shaping.
Greek, Cyrillic, Arabic, Hebrew, Thai and emoji showed as boxes, and
right-to-left text read backwards.

## Decision
- **Fonts per script, picked per character.** Inter's subset gains Greek
  and Cyrillic. New fallback fonts come from Noto: Arabic (with the
  presentation-form blocks), Hebrew, Thai, and Noto Emoji, which is
  monochrome outlines that the coverage rasteriser draws in the text
  colour. `tools/build_fonts.py` subsets them, with no layout tables. A
  character whose script has a font tries that font first, then the
  style's chain. Formatting characters (ZWJ, variation selectors,
  skin-tone modifiers, direction marks) draw nothing.
- **Arabic joining through presentation forms** (`ceangal/src/bidi.almd`):
  each letter's contextual form (isolated, initial, medial, final) by its
  joining type, lam-alef ligatures, marks transparent. This covers Arabic,
  Persian and Urdu letters without a GSUB interpreter.
- **A reduced Unicode Bidirectional Algorithm** for one line: paragraph
  direction from the first strong character, numbers as left-to-right runs
  inside right-to-left text, neutrals taking the direction of their
  surroundings, runs reversed by level, brackets mirrored. No explicit
  embeddings or isolates (LRE/RLI…): they are dropped as invisible.
- Labels and text (`ceangal.text.width`, `draw`) go through joining and
  reordering. The editor keeps logical order, because its caret and
  selection are computed on the stored text.
- **Fallback fonts load lazily on the web.** CJK (2.3 MB) used to load
  before the app started. Now `asset_len` starts the fetch the first time
  the app asks, and text redraws until the font arrives. Thai combining
  marks have zero advance and negative bearings in Noto, so they sit over
  their base without GPOS.

## Consequences
- Scripts that need real shaping (Devanagari, Bengali and the other Indic
  scripts, Myanmar, Khmer) and colour emoji are not supported (Devanagari,
  Bengali and Tamil since ADR 0010, colour emoji since ADR 0011). They need a
  GSUB/GPOS interpreter and a colour-glyph path (COLR or bitmaps), which
  are larger projects.
- Text fields show right-to-left text in logical order and Arabic
  unjoined.
- The pixel harness disables lazy loading (`lazy: () => false`), so a
  screenshot never depends on when a font arrives.
- Apps ship about 1 MB more of fonts on the native targets (the emoji font
  is 0.8 MB). The web downloads them only if a page uses them.
