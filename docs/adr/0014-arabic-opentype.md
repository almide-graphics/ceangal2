# ADR 0014 — Arabic through the font's GSUB / GPOS

## Context
ADR 0009 joined Arabic by mapping each letter to a presentation form
(U+FB50–U+FEFF) and drew lam-alef as one glyph with an invisible alef.
That covers the letters the presentation blocks have. It cannot place
marks over ligatures, kern, or use a font's contextual alternates, and
its output differs from HarfBuzz's. ADR 0010 then added a GSUB / GPOS
engine (`snaidhm/src/otl.almd`) for the Indic scripts.

## Decision
- **Arabic is shaped with the font's tables, as HarfBuzz's Arabic shaper
  does** (`ceangal/src/arabic.almd`):
  - marks are put in HarfBuzz's order (shadda first; the hamza-like marks
    moved to the front of their run);
  - each letter's form comes from HarfBuzz's joining state machine, using
    joining types from Unicode's ArabicShaping.txt
    (`tools/gen_arabic.py` → `arabic_data.almd`);
  - the stages are `ccmp locl`, then `isol fina fin2 fin3 medi med2 init`
    (one stage each), then `rlig rclt calt`, then `mset liga clig`;
  - GPOS applies `kern mark mkmk curs dist`, and marks get zero width.
- **otl gains mark-to-ligature (GPOS 5).** A ligature records which of
  its parts each following mark belongs to (`Info.comp`).
- **bidi only orders.** `bidi.levels` and `bidi.order_of` replace
  `bidi.layout` and `bidi.visual`. The joining code and the presentation
  form table are removed.
- **`text.shape_line`** cuts a line into segments of one level (and,
  right to left, Arabic or not), puts the segments in display order and
  shapes each one:
  - left-to-right segments as before;
  - Arabic with `arabic.shape`, cached by text;
  - other right-to-left text (Hebrew) reversed and mirrored glyph by
    glyph.

  `width`, `draw` and `LineGeo` all use it. In `LineGeo`, a cluster of
  several characters (lam-alef, a letter with marks) shares its width
  among them in reading order. This lets the caret move inside it and
  lets backspace remove a lam-alef's alef.
- The Arabic font is subset with all of its layout features
  (`tools/build_fonts.py`); it is now 107 KiB.
- `tests/shaping/arabic.txt` holds HarfBuzz's output for 38 words and
  phrases: joining, lam-alef, marks, Persian, Urdu, ZWJ / ZWNJ, digits
  and brackets. `arabic_test.almd` must match it exactly, glyph ids and
  positions, and CI runs it.

## Consequences
- The wasm grows by about 9.7 KB:
  - the shaper is about 7.5 KB, of which mark ordering is 2 KB;
  - the segment layout is about 3 KB;
  - removing the old joining code saved about 1 KB.

  Moving loops off closures, packing the tables into hex strings and
  folding the class rules into the generated data took off 2 KB. The
  budgets rise:

  | App | Before | After | Measured now |
  |---|---|---|---|
  | gallery | 220 KB | 225 KB | 224.3 KB |
  | todo | 200 KB | 204 KB | 203.0 KB |
  | hello | 200 KB | 202 KB | 201.3 KB |

  Getting the budgets back down is part of the size work (wasm-opt in
  release, shared table unpacking).
- Arabic now matches HarfBuzz for the tested words, including marks on
  lam-alef and other ligatures. Text that mixes Arabic with Hebrew in one
  right-to-left run splits into segments, so no joining happens across
  the split (neither script joins with the other).
- Persian and Urdu letters are shaped from the same font. Scripts that
  use the Arabic letters with other fonts (Nastaliq) are out of scope.
