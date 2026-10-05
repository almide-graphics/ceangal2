# ADR 0017 — Line breaking by UAX #14

## Context
The editor's soft wrap broke a line after the last space that fit. With
no space in the row (Japanese, Chinese, Thai, a long URL), it broke at
whatever character overflowed. That could split an emoji sequence or a
letter from its marks, and could start a row with "。" or "、".

## Decision
- **`ceangal.linebreak.opportunities(cps)`** gives, for each character,
  whether a line may break before it: no, allowed, or mandatory. It
  follows the Unicode Line Breaking Algorithm (UAX #14, Unicode 16.0),
  rules LB2–LB31:
  - marks and ZWJ attach to their base (LB9/LB10);
  - spaces, quotes (initial / final, East Asian context), brackets,
    hyphens, numbers with their prefixes and postfixes (LB25), Hangul
    jamo and syllables, regional indicator pairs, emoji modifiers;
  - CJK breaks between ideographs and kana, except before closing
    punctuation and small kana (kinsoku).

  Not followed:
  - LB28a, for the Brahmic aksara classes (Balinese, Javanese and other
    scripts with no bundled font); those letters count as AL;
  - LB30b's unassigned pictographs;
  - Thai, Lao, Khmer and Myanmar word breaking, which needs a dictionary.
    Following LB1, they are AL and break only at spaces.
- **Classes are a default by block plus a table.** CJK ideographs, Hangul
  syllables and the emoji blocks have defaults; anything else defaults to
  AL. The table holds the exceptions in the blocks listed in
  `tools/gen_linebreak.py` (469 ranges in 1.5 KB). Each run is three
  variable-length base-32 numbers written as letters, with a binary
  search on lookup. East Asian width comes from ranges.
- **Tests are Unicode's own.** `tests/linebreak/cases.txt` keeps the
  8014 `LineBreakTest.txt` lines whose code points this classification
  covers exactly; `linebreak_test.almd` must match every one.
- **The editor wraps at the last opportunity that fits.** When a row has
  none, it breaks at the last caret stop that fits, never inside an
  emoji or a conjunct.
- **Fonts can invalidate the wrap cache.** `text.font_generation()`
  counts loaded fonts, and the editor's row cache keys on it. Rows
  measured before the CJK fallback font arrived on the web had the wrong
  widths and overlapped the next line.

## Consequences
- Wrapped Japanese and mixed text in the playground's narrow layout
  breaks between characters and keeps punctuation where Japanese
  typography expects it. `tests/e2e/web.mjs` takes a screenshot of it.
- Text views (labels) still don't wrap. Wrapping them with the same
  opportunities is the next step.
- The wasm grows by about 4.4 KB optimized: the rules about 3 KB, the
  table 1.5 KB. Together with ADR 0016's bidi (about 4.2 KB), the
  budgets move:

  | App | Before | After | Measured now |
  |---|---|---|---|
  | gallery | 170 KB | 176 KB | 173.1 KB |
  | todo | 152 KB | 158 KB | 155.3 KB |
  | hello | 150 KB | 156 KB | 152.6 KB |

  These are still well under ADR 0014's 225 / 204 / 202 KB, which were
  measured before wasm-opt.
