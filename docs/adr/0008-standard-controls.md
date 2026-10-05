# ADR 0008 — Standard controls, and the layout fixes they needed

## Context
Apps built every control from `v.text |> v.on_click |> v.role |> v.label`.
Each app redid hover, focus, keyboard activation and screen-reader state,
or more often left them out. `ceangal.toml` typos were also silently
ignored.

## Decision
- **`ceangal.widgets`**: buttons (primary, secondary, danger, text,
  disabled), checkbox, switch, radio group, segmented control, slider,
  progress bar, text field, title / heading / body / caption / link,
  card, divider, list row and dialog, all styled by a `Theme` record
  (`light()`, `dark()`, `system()`).
  - Controls are stateless functions. The app passes the value and gets
    the change in a callback, like the rest of the view model.
  - A control's key (for focus and hover) is derived from its label, so
    the API needs no keys. Labels must be distinct on a screen, which
    screen readers need anyway.
  - Every control is a Tab stop. Enter or Space activates it, and arrows
    move radio groups, segments and sliders. Each shows a focus ring and
    reacts to hover and press.
- **The runtime gained what the controls need** (and custom controls can
  use): `ceangal.is_hovered(key)` and `is_pressed(key)` (mouse hover;
  press for both mouse and touch), `v.checked`, `v.selected` and
  `v.disabled` (ABI flags 4/8/16, sent to both hosts), and roles 15–20
  (switch, slider, dialog, radio button, radio group, progress bar), which
  ARIA and AccessKit map. AccessKit's Increment and Decrement (ABI actions
  3/4) reach a view as Right / Left arrow keys, so a screen reader adjusts
  a slider through the same code as the keyboard.
- **Layout fixes found by the gallery**, each with a test in
  `layout_test.almd`:
  - A column measures its children at its own inner width, so a wrapping
    row inside it gets the height of all its lines.
  - In-flow children's percentage sizes resolve against the parent's
    inner box (only absolute children handled them before).
  - An absolute child with both left and right (or top and bottom) and no
    size spans between them.
- `apps/gallery` shows every control. `tests/e2e/gallery.mjs` drives it in
  Chrome by pointer, keyboard and typing, checks each role and state in
  the accessibility tree, and runs in the `framework` CI job, which also
  builds it natively.
- `ceangal new` starts from the controls and the system theme.
- `ceangal.toml` is checked on every command (`cli/src/check.almd`). An
  unknown key is a warning that names the nearest known one. A wrong
  type or form (IDs by Android's rules, versions, colours, the build
  number range) or a missing path is an error before any build.

- **`ceangal test`**: an app's `tests/*.test`, one step per line (tap,
  type, key, see, not, wait, shot), views found by accessible label. The
  same file runs on the web build in headless Chrome
  (`tests/e2e/app_test.mjs`) and on the native build headless (a runner in
  `ceangal/native/host.rs`, `CEANGAL_TEST`, with the accessibility tree
  forced on). A text format rather than an Almide or JS API: the steps are
  what a user does, both runners can read it, and a failure prints the
  line and every label on screen. `ceangal new` writes one; `app.yml` runs
  them; this repository's CI runs the reference apps' on macOS (web and
  native), Linux and Windows (native).

## Consequences
- The percentage fix changes layouts that used `w_pct` / `h_pct` /
  `fill()` on in-flow children, where they had no effect before. In this
  repository that is the playground's HTML `<br>`, which now spans the
  line as intended.
- No dropdown or menu yet: they need a layer above the page that closes
  on outside clicks. `dialog` is the pattern to build it on.
- `almide test` reports a failing test in this package as a rustc error
  (almide/almide#3424). `--target wasm` shows the real failure.
