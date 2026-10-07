# ADR 0023 — Absorbing other ecosystems' libraries

## Context
Flutter, React Native, iOS and Android apps lean on thousands of
third-party libraries: colours, dates, Markdown, charts, maps, crypto and
more. ceangal has a few dozen standard controls and its own text stack. The
plan is to take that work over as ceangal's own Almide code, library by
library, until nothing an app needs is missing. This ADR fixes how.

The text work already showed the method. Bidi (python-bidi), line breaking
(Unicode's LineBreakTest) and Arabic / Indic shaping (HarfBuzz) were each
rebuilt here and checked against the original's results until every
recorded case matched.

## Decision
- **The original is an oracle, not a source.** Each library goes through
  the same steps:
  1. Pick the parts apps use: the API and the behaviour, not the code.
  2. Install the original outside the repository (a scratch directory),
     run it on generated inputs, and record its answers:
     - the generator lives in `tools/absorb/gen_<name>_cases.mjs` (or
       `.py`);
     - the cases live in `tests/absorb/<name>.txt`.
  3. Write the Almide module from that behaviour and from the public
     specification (CSS, WCAG, Unicode, …). The original's source is not
     copied or translated.
  4. Add `<name>_test.almd`, which must match every recorded case on wasm
     and natively, as a CI step.
  5. Document the module (`docs/api`) and the oracle (the module's
     header and this ADR's log).
- **Licences.**
  - Clean-room reimplementation from behaviour means the original's
    copyright doesn't extend to ceangal's code.
  - Recorded input / output pairs are facts, not creative works.
  - Even so, the oracle and its licence are named in the module header.
  - GPL / LGPL libraries go strictly through this route: whoever writes
    the Almide code, an AI included, works from the behaviour and the
    specification, not from the source.
  - Patented algorithms (some codecs, for example) are checked one by
    one before they are taken on.
  - Store and platform SDKs (payments, push, maps, camera) are not
    absorbed. They are platform services, reached through
    `ceangal_platform` as the clipboard and file pickers are (ADR 0004),
    under the SDKs' terms.
- **Order**: what the most apps need first (colours, dates and times,
  Markdown, charts, formatting numbers, regular expressions…).
- **Size**: an absorbed module costs nothing in apps that don't call it
  (the wasm keeps only what is reached). Budgets (ADR 0015) are checked
  per app as before.

## Log
| Library | Oracle | Module | Cases |
|---|---|---|---|
| tinycolor2 (MIT): parsing, writing, lighten / darken / saturate / spin / mix, WCAG luminance and contrast | tinycolor2 1.6.0 | `ceangal.color` | 4808, all matching on wasm and natively |

Not taken from tinycolor2 yet:
- the 148 CSS colour names;
- `hsv()` input;
- `analogous` / `triad` palettes;
- `mostReadable`.

## Consequences
- `ceangal.color` exists: `parse`, `to_hex` / `to_hex8` / `to_rgb_string` /
  `to_hsl_string`, `lighten`, `darken`, `saturate`, `desaturate`, `spin`,
  `mix`, `luminance`, `contrast`, `readable`, and `to_color` / `from_color`
  for drawing.
- The first run matched all 4808 cases. A deliberately corrupted case makes
  the test fail, so the check is real.
- Writing the module ran into almide/almide#3439 (a type takes over a
  same-named type in another module): the type is `Swatch`, not `Rgba`.
- The next candidates: dates and times (formatting, relative time), and
  Markdown to views.
