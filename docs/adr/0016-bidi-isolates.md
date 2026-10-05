# ADR 0016 — Bidi: embeddings, overrides and isolates, checked against unicode-bidi

## Context
`ceangal.bidi` (ADR 0009) was a reduced Unicode Bidirectional Algorithm
for one line:
- the paragraph direction from the first strong character;
- numbers kept left to right;
- neutrals taking the direction on both sides.

It dropped the explicit controls: LRE/RLE/LRO/RLO/PDF, LRI/RLI/FSI/PDI,
and the LRM/RLM/ALM marks. A user name or a file name dropped into a
right-to-left sentence could not be isolated, and text that used the
controls was laid out as if they weren't there.

## Decision
- **`bidi.levels` follows UAX #9 for the rules that matter on one line:**
  - P2–P3: paragraph direction, skipping isolates;
  - X1–X8: a directional status stack up to level 125, with overrides,
    isolate initiators matched to their PDIs, and unmatched PDIs and PDFs
    ignored;
  - X9: embedding controls removed;
  - X10: level runs joined into isolating run sequences, with sos and eos
    from the neighbouring levels;
  - W1: marks take the type before them;
  - W7: European numbers after L become L;
  - N1–N2: neutrals and isolate controls;
  - I1–I2: implicit levels;
  - L1: tabs, and whitespace and isolate controls before a tab or at the
    end of the line, take the paragraph level.

  Removed controls take the level before them, so they never split a run
  when reordering. Arabic-Indic digits are AN; Arabic marks are NSM.
- **Not done:** bracket pairs (N0), number separators and terminators
  (W4–W6), and the AL-specific number rules (W2–W3). Arabic letters count
  as R.
- **Oracle tests.** `tools/gen_bidi_cases.py` writes `tests/bidi/cases.txt`:
  1000 random lines over letters of both directions, both kinds of digit,
  a mark, spaces, a tab, a neutral and every control. The expected display
  order comes from python-bidi, which wraps the `unicode-bidi` crate.
  `bidi_test.almd` must match every line. The alphabet leaves out what is
  not done.

  On 3000 such lines, one string disagrees: "1", LRO, "١", "ב", space,
  RLE. P2 takes the paragraph direction from the first strong character
  even inside an override, which makes this line right-to-left; the oracle
  lays it out left-to-right. The generator skips that string.
- **The controls draw nothing** (`text.invisible` now covers U+2066–2069
  and ALM).
- **The caret on the left edge of a right-to-left character is drawn to
  its left.** Before, it covered narrow glyphs such as "!".

## Consequences
- `ISOLATE(name)` patterns work: an English name with digits inside a
  Hebrew or Arabic sentence keeps its order and does not pull the
  neutrals around it. `apps/gallery/tests/rtl.test` types one into a
  field.
- With separators, "1.5" or "١٫٥" inside right-to-left text can still be
  split around the separator. W4–W6 are the next step if that shows up.
- almide/almide#3438: a string literal containing these controls doesn't
  compile natively (rustc's `text_direction_codepoint_in_literal`). Build
  such strings with `string.from_codepoint` instead. The tests use code
  point lists.
