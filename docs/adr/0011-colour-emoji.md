# ADR 0011 — Colour emoji from COLRv0 layers

## Context
Emoji were drawn from Noto Emoji, a monochrome outline font, in the text
colour. Skin tones were dropped. ZWJ sequences (a family, a profession) fell
apart into their parts, and flags showed as two letters. Colour fonts come
in four formats. sbix and CBDT embed PNG bitmaps, which would need a PNG
decoder and a colour atlas. SVG needs a vector renderer per glyph. COLRv1
needs gradients and compositing. COLRv0 is ordinary outlines stacked in
palette colours.

## Decision
- **Twemoji Mozilla (COLRv0) as the colour emoji font**
  (`assets/fonts/emoji-color.ttf`, 1.1 MB). The art is CC-BY 4.0 and the
  build Apache-2.0 (`LICENSE-TwemojiMozilla.md`). Its glyphs are glyf
  outlines, so the existing rasteriser draws each layer into the coverage
  atlas. `snaidhm/src/colr.almd` reads a glyph's layers and their CPAL
  colours. `text.Glyph` gains `color` (-1 = the text's colour). A colour
  glyph becomes one Glyph per layer, drawn bottom first, faded with the
  text's alpha.
- **Emoji sequences by UTS #51**, from Unicode's emoji-data
  (`tools/gen_emoji.py` → `emoji_data.almd`). A sequence is one of:
  - a default-emoji character (Emoji_Presentation), or a pictographic one
    with U+FE0F or a skin tone, plus its tags, joined to more by ZWJ;
  - two regional indicators (a flag);
  - a digit, # or * with U+20E3 (a keycap).

  U+FE0E keeps text presentation. The font's own `ccmp` turns a sequence
  into its glyph, run through `snaidhm.otl`. Joiners and selectors it did
  not fold in draw nothing.
- **Text presentation stays monochrome.** Characters that are text by
  default (☺, ♥, ✔ without U+FE0F) still come from Noto Emoji in the text
  colour, as before.
- **One emoji is one character to the editor.** A sequence is one
  cluster. `text.stops` gives the caret stops (not inside an emoji or a
  conjunct), and arrows and clicks use them. `text.backspace_to` deletes
  a whole emoji but one sign of an Indic conjunct, as typing built it.

## Consequences
- Emoji up to Unicode 14 draw in colour: skin tones, families,
  professions, flags, keycaps and tag flags, in labels and text fields,
  identically on every target (no system emoji font). Emoji 15 / 15.1
  additions draw as their parts or as a box until the font is updated.
- The wasm grows by about 12 KB (sequence detection, emoji data, COLR);
  budgets: gallery 220 KB, todo and the template 200 KB.
- Native apps carry 1.1 MB more of fonts. The web loads the font only
  when a page shows an emoji.
- Twemoji's style is not the platform's (Apple, Google, Microsoft). An
  app that wants system emoji would need the host to rasterise them,
  which ceangal does not do.
