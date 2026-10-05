# Changelog

Framework releases: a tag `v<version>` that apps pin in `ceangal.toml`
(`[framework] version`), with the `ceangal` CLI's binaries on the GitHub
release. The release workflow takes the release notes from this file.

## Unreleased

- **Line breaking by UAX #14** (`ceangal.linebreak`): the editor's soft
  wrap breaks between CJK characters, after hyphens and spaces, never
  before closing punctuation or inside an emoji or conjunct; 8014 lines
  of Unicode's LineBreakTest.txt pass. Wrapped rows are measured again
  when a fallback font arrives. (ADR 0017)
- **Bidi embeddings, overrides and isolates** (LRE…PDF, LRI/RLI/FSI…PDI,
  LRM/RLM/ALM): followed as UAX #9 does, with isolating run sequences;
  1000 random lines match unicode-bidi's order. The caret on a
  right-to-left character's left edge no longer covers it. (ADR 0016)
- **Smaller web builds**: the app's wasm goes through a pinned `wasm-opt
  -Oz` (about 28% smaller; the gallery 230 → 167 KB). `ceangal dev` skips
  it. Size budgets now measure the optimized module. (ADR 0015)
- Emoji ZWJ sequences, flags and pointed Hebrew inside right-to-left text
  stay whole (clusters are laid out from the right).
- **`ed.with_align_end`**: a text field or editor whose line reads right
  to left starts it at the right edge; clicks and the caret follow.
- **Arabic shaped with the font's OpenType tables**, as HarfBuzz does:
  joining forms, lam-alef and other ligatures, marks placed over letters
  and ligatures, kerning. 38 test words and phrases match HarfBuzz
  exactly. `text.shape_line` lays out a mixed-direction line;
  `text.display` is removed. (ADR 0014)
- **Gurmukhi, Gujarati, Telugu, Kannada and Malayalam**, shaped like the
  other Indic scripts (reph by script, pre-base-reordering Ra, Malayalam's
  dot reph): 363 words in eight scripts match HarfBuzz. (ADR 0010)
- **Dropdown and menu** (`w.dropdown`, `w.menu_button`): lists that float
  over the window, by pointer, keyboard and screen reader (combo box,
  list box, menu roles; expanded state). Underneath: `v.overlay()` and
  `ceangal.open_popup` / `close_popup` / `popup_open` for popups of your
  own. (ADR 0013)
- **Android file picker**: `ceangal.open_text_file()` opens the system
  picker (a small framework activity takes its result for the
  NativeActivity).
- **Right-to-left text in text fields and the editor**: shown in visual
  order and joined, edited in logical order; selection, syntax colours
  and clicks follow the screen; Left / Right move on screen. (ADR 0012)
- **Colour emoji** (Twemoji, COLRv0): skin tones, ZWJ sequences, flags and
  keycaps, the same on every target; the caret and Backspace treat an
  emoji as one character. (ADR 0011)
- **Devanagari, Bengali and Tamil**, shaped with the fonts' OpenType
  tables (GSUB / GPOS) by a new layout engine (`snaidhm.otl`) and an Indic
  shaper (`ceangal.indic`). Conjuncts, half forms, reph, pre-base vowel
  signs and stacked marks match HarfBuzz on 203 test words, in labels and
  text fields. (ADR 0010)
- **Standard controls** (`ceangal.widgets`): buttons, checkbox, switch,
  radio group, segmented control, slider, progress bar, text field, text
  styles, card, list row, dialog; light / dark / system themes. Keyboard,
  focus ring, hover / press, and screen-reader roles and states built in.
  `ceangal new` starts from them. (ADR 0008)
- **`ceangal test`**: `tests/*.test`, steps that tap, type, press keys and
  check what is on screen by accessible label, on the web build (headless
  Chrome) and the native build (headless). `ceangal new` writes one;
  `app.yml` runs them.
- **`ceangal.toml` is checked** on every command: unknown keys warn with
  the nearest known one; wrong types, malformed IDs / versions / colours
  and missing paths are errors.
- Runtime: `ceangal.is_hovered` / `is_pressed`, `v.checked` / `selected` /
  `disabled`, accessibility roles for switch, slider, dialog, radio
  button / group and progress bar, screen-reader increment / decrement.
- Layout: wrapping rows inside columns get the height of all their lines;
  percentage sizes work for in-flow children; absolute views with left
  and right (top and bottom) span between them.
- Phones: `copy_text` uses the system clipboard on iOS and Android;
  `save_file` opens the share sheet on iOS and saves into the shared
  Downloads folder on Android 10+; `open_text_file` opens the document
  picker on iOS.
- Text: Greek and Cyrillic in the UI font; Arabic (joined), Hebrew, Thai
  and emoji fallback fonts; right-to-left lines in visual order (bidi).
  On the web, fallback fonts (CJK included) load on first use instead of
  before the app starts.
- Screen readers: TalkBack on Android and VoiceOver on iOS see ceangal
  apps; plain text is read on every platform (it was empty to AccessKit
  readers before).
- Releases carry `SHA256SUMS`, which `install.sh` / `install.ps1` verify.
- Docs: a testing guide; the guide's examples are type-checked in CI;
  every public function is documented.
- CLI: output before a child process is no longer delayed; the framework
  download is quiet; `ceangal new` writes a Windows framework path TOML
  can read; `ceangal dev` watches only what the build reads (a log in the
  app directory no longer rebuilds forever) and survives a crashing app.

## 0.2.0 — 2026-10-05

- **`ceangal dev`**: rebuilds on save; the web page reloads by itself and
  shows a failed build's error; desktop apps restart. (ADR 0007)
- **The CLI as binaries**: macOS (universal), Linux x86_64 / aarch64
  (static), Windows, installed by `install.sh` / `install.ps1`.
- `ceangal --version`, `ceangal doctor` (what each platform needs, and
  how to get what is missing).
- `ceangal.storage` (values and secrets), `ceangal.http`, `ceangal.asset`,
  `open_url`, `set_title`, `save_file`, `open_text_file`.
- The guide (`docs/guide`) and the generated API reference (`docs/api`).
- `app.yml` imports the Mac signing certificates.

## 0.1.0 — 2026-10-05

- `ceangal.toml` and the `ceangal` CLI (`new`, `build`, `run`, `icons`,
  `env`, `info`); every platform's build and store packaging driven by the
  app's settings; the reusable `app.yml` workflow. (ADR 0006)
