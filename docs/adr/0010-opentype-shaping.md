# ADR 0010 — OpenType layout and Indic shaping in Almide

## Context
ADR 0009 got text beyond Latin as far as fonts per script, Arabic joining
through presentation forms and a reduced bidi can go. Devanagari, Bengali
and Tamil could not be drawn this way. Their conjuncts, half forms, reph,
pre-base matras and mark positions come from the font's GSUB and GPOS
tables, after a shaper has cut the text into syllables and reordered it.
Hindi, Bengali and Tamil together are read by over a billion people.

## Decision
- **An OpenType layout engine in snaidhm** (`snaidhm/src/otl.almd`). It
  reads GDEF (glyph classes, mark attachment classes, mark filtering
  sets) and runs GSUB lookups: single, multiple, ligature, context and
  chained context (formats 1–3), extension. It runs GPOS lookups: single,
  pair, mark-to-base, mark-to-mark, chained context, extension. These are
  the lookup types the bundled Indic fonts use (counted with fontTools).
  Glyphs are skipped by lookup flag, and ZWJ / ZWNJ are skipped the way
  HarfBuzz skips them. A shaper picks lookups by script and feature into
  stages; each lookup carries the mask of the features that use it.
- **An Indic shaper in ceangal** (`ceangal/src/indic.almd`), following
  the OpenType Indic spec as HarfBuzz implements it:
  - split matras are decomposed;
  - the text is cut into syllables, and a broken one gets a dotted circle;
  - the base consonant is found from the forms the font has
    (`would_substitute` on blwf / pstf / vatu);
  - the initial reordering puts the pre-base matra and the reph's Ra in
    place and sets per-glyph feature masks;
  - the basic features run one stage each;
  - the final reordering moves the matra after unformed half forms and the
    reph to its script's position;
  - the presentation features run, then GPOS.

  The character tables are generated from Unicode's
  IndicSyllabicCategory / IndicPositionalCategory (`tools/gen_indic.py`).
- **Fonts keep their layout tables.** Noto Sans Devanagari (160 KB),
  Bengali (95 KB) and Tamil (38 KB) are subset with every feature. Like the
  other fallbacks, they load lazily on the web.
- **HarfBuzz is the reference, at build time only.**
  `tools/gen_shaping_cases.py` (uharfbuzz) records HarfBuzz's glyph ids,
  clusters, advances and offsets for 203 words: conjunct stacks, reph
  with matras, ZWJ / ZWNJ, nukta letters, split vowels, broken clusters.
  `indic_test.almd` requires identical output, and CI runs it. ceangal
  ships no HarfBuzz.
- **Glyphs carry clusters.** `text.Glyph` gains `y` (a mark's offset) and
  `cluster` (the first code point it draws). The editor maps the caret to
  `text.edges` (code point boundaries; positions inside a conjunct are
  spread across it) and draws token colours with `text.glyphs_in`. It no
  longer assumes one glyph per code point. Shaped Indic runs are cached
  per text, so a frame does not rerun the lookups.

## Consequences
- Hindi, Marathi, Nepali, Sanskrit, Bengali, Assamese and Tamil text
  shapes as HarfBuzz shapes it, in labels and in text fields, on every
  target.
- The wasm of an app grows by about 45 KB (a gallery build goes from
  140 KB to 185 KB). The budgets in `tests/perf/budgets.json` rise to
  match. Editor frames do not slow down: the per-glyph path for other
  text got faster in the same change.
- Myanmar, Khmer and the USE-shaped scripts need their own shapers on the
  same engine. Oriya and Sinhala need a font and their rows in the script
  table.
- Arabic still joins through presentation forms. Moving it to the font's
  GSUB (init / medi / fina, mark positioning) would now be possible.

## Update (2026-10-06): eight scripts
Gurmukhi, Gujarati, Telugu, Kannada and Malayalam were added, each with
its Noto Sans font (24–133 KB, lazy on the web). The script table gives:

- Ra and the virama as fixed offsets in each block;
- the reph's position (before the sub-joined forms, after them, before or
  after the post-base forms, or after the main consonant);
- how a reph is written: Ra + virama, Ra + virama + ZWJ (Telugu), or a
  repha character (Malayalam's dot reph, U+0D4E);
- whether consonants before the base take below-base forms (not Telugu
  and Kannada);
- each script's matra positions.

The shaper also reorders a pre-base-reordering Ra (pref), skips
Malayalam's unformed below-base forms when finding the base, and treats
Kannada's legacy Ra, virama, ZWJ as Ra, ZWJ, virama. 363 words in eight
scripts match HarfBuzz.

The character tables (indic_data, emoji_data) are now packed strings,
unpacked on first use. A list of tuples cost about 4 KB of wasm per
hundred rows, a string about a tenth of that. That keeps the code for the five
scripts inside the size budgets.
