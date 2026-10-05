# ADR 0012 — Right-to-left editing: logical text, visual lines

## Context
ADR 0009 put labels in visual order but left text fields and the editor
in logical order. Their caret, selection, syntax colours and hit testing
assumed that position n is drawn after position n − 1. Hebrew typed into
a field read backwards, and Arabic stayed unjoined.

## Decision
- **The text stays logical; each line is laid out for display.**
  `bidi.layout(cps, base)` returns, for each character in logical order,
  its shape (joined, mirrored in right-to-left runs; a lam-alef's alef
  becomes U+200B, drawn by the lam), its embedding level, and the display
  order. `bidi.visual` (labels) is the same algorithm. (Since ADR 0014:
  `bidi.levels` / `order_of` give the levels and order, and
  `text.shape_line` shapes the line, with Arabic run through the font's
  tables.)
- **`text.LineGeo`** holds what editing needs, in logical positions:
  - the caret x at each position 0..n (on the trailing side of the
    character before it: its left edge when that character is right to
    left);
  - each character's left and right edge as shown;
  - the glyphs, whose clusters are character indices.

  `geo_spans` turns a range into the stretches it covers on screen (a
  selection across a change of direction is several rectangles);
  `geo_glyphs` gives the glyphs of a range (token colours);
  `geo_nearest` is hit testing to a caret stop. Lines without
  right-to-left text keep the existing path: shaping in order, one
  stretch per range, clusters ascending.
- **Wrapping breaks logically, then reorders each row**, with the line's
  paragraph direction (UAX #9 reorders per line). Breaks use the
  characters' widths laid end to end (`widths_of`).
- **Arrows move on screen.** Left / Right step to the neighbouring caret
  stop in that direction: forward in the text through right-to-left runs,
  backward through left-to-right ones. Word movement and Home / End stay
  logical, as on most platforms.

## Consequences
- Hebrew and Arabic (joined) read correctly in fields and the editor. A
  mixed line (an English word or a number inside Arabic, Arabic inside
  English) selects and colours by what is on screen.
- Fields stay left-aligned whatever the paragraph direction. Right
  alignment for a right-to-left paragraph is a later option of the field.
- An emoji ZWJ sequence inside right-to-left text is reordered character
  by character (the reduced bidi treats its parts as neutrals). The
  ADR 0009 limits still apply: no explicit embeddings or isolates.
- `apps/gallery/tests/rtl.test` types Hebrew and Arabic, moves with the
  arrows, inserts mid-word and deletes a lam-alef's alef, on the web and
  the native build.
