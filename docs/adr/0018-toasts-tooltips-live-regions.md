# ADR 0018 — Toasts, tooltips and live regions

## Context
Apps had no way to say "saved" without a dialog, and nothing reached a
screen reader unless the user moved to it. The accessibility tree (ADR
0002) is rebuilt every frame, which made it unsuitable for announcements.
Controls also had no tooltips.

## Decision
- **New roles**:
  - 26 *status* (a polite live region);
  - 27 *alert* (an assertive one);
  - 28 *tooltip*.

  On the web they are `role=status`, `alert` and `tooltip`. In AccessKit
  (macOS, Windows, Linux, iOS, Android) they are `Role::Status` with
  `Live::Polite`, `Role::Alert` with `Live::Assertive`, and
  `Role::Tooltip`.
- **The web host keeps two live regions in the page**, one polite and one
  assertive. They are outside the rebuilt tree and are never removed. After
  each commit, it puts the text of the status and alert nodes into them.
  Screen readers announce changes to a region that already exists, not
  regions that appear.
- **`ceangal.toast(text)`** shows a bubble near the bottom of the window,
  as an overlay, for 4 s of frame time. It is a status, so it is
  announced. Frame time comes from the host clock, so `ceangal test`'s
  `wait` expires it the same way natively and on the web.
- **`w.tooltip(th, text, control)`** shows `text` under the control in two
  cases:
  - the pointer has rested on the control for 0.6 s (`hover_rested`);
  - the keyboard has focused it (`keyboard_focused`). The runtime notes
    whether the last input was a key or a press, so a click does not leave
    a tooltip behind.

  The bubble is an overlay child of the control, so showing it never moves
  the layout. Delayed frames wake the runtime for the hover delay and the
  toast's end.
- Wrapping text (ADR 0017) in a row starts at the smaller of its one-line
  width and its maximum width, so the toast's bubble fits its text.

## Consequences
- `apps/gallery/tests/announce.test`, on the web and natively, covers:
  - the tooltip on keyboard focus, gone after a pointer press;
  - the toast, gone after its time.

  `tests/e2e/gallery.mjs` checks in Chrome:
  - the toast's status role and the polite live region's text;
  - the tooltip's role on focus and after the pointer rests.
- Touch devices don't show tooltips yet: a long press is the platforms'
  gesture for them, and context menus will use it too. They should be
  decided together.
- `w.alert` is not added yet: role 27 is in place for an error banner.
- The runtime grows by about 1.5 KB of optimized wasm (the toast, hover
  timing and the roles), in every app. Each budget rises by 4 KB, which
  also covers the next control:

  | App | Before | After | Measured now |
  |---|---|---|---|
  | gallery | 176 KB | 180 KB | 177.2 KB |
  | todo | 158 KB | 162 KB | 158.9 KB |
  | hello | 156 KB | 160 KB | 156.1 KB |
