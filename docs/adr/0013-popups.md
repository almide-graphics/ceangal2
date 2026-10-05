# ADR 0013 — Popups: overlay views, one open popup, dropdown and menu

## Context
The standard controls (ADR 0008) had no dropdown or menu. A popup list has
two needs that the view tree did not meet. It must be drawn over whatever
comes after its control: views paint in tree order, so a later card would
cover it. It must also escape its ancestors' clipping (a card in a scroll
view). It also has state no control kept: whether it is open, and which
entry the keyboard is on.

## Decision
- **`v.overlay()`** places a view like `v.absolute()`, in its parent, but
  the runtime:
  - paints it after the whole window;
  - gives it the pointer before anything else (hit testing, hover,
    cursor);
  - drops the clip its subtree inherited (its own clips stay).

  Overlays inside overlays paint after their parent overlay. The layout
  is unchanged, so an overlay follows its control as it scrolls.
- **One popup at a time, kept by the runtime** like focus:
  - `open_popup(key, highlighted)`, `close_popup()`, `popup_open(key)`,
    `popup_highlight()`, `set_popup_highlight(i)`;
  - a press outside the overlay and its control closes it, and that press
    and its release do nothing else (as on macOS and in browsers);
  - focus moving to another control closes it too.
- **`w.dropdown(th, label, options, index, on_select)`** is a field-like
  button with the current choice that opens the list under it (over it
  near the window's bottom). Enter, Space or Alt+Down opens it; Up / Down
  move the highlight; Enter picks; Escape closes. While closed, Up / Down
  change the choice. Clicking an entry picks it and leaves focus on the
  control.
- **`w.menu_button(th, title, [(entry, action)])`** opens a menu of
  actions with the same keys.
- **Accessibility**: roles 21 combo box, 22 list box, 23 option, 24 menu,
  25 menu item. Flags 32 (opens a popup) and 64 (open) map to
  aria-expanded / aria-haspopup on the web and to `set_expanded` /
  `set_has_popup` in AccessKit (macOS, Windows, Linux, iOS, Android).

## Consequences
- Apps get a dropdown and a menu with keyboard and screen-reader support,
  and can build their own popups (autocomplete lists, tooltips) from
  `v.overlay()` and the popup calls.
- The entries are not separate Tab stops: focus stays on the control
  while the list is open, as with native selects. Screen readers reach
  the entries through the list box / menu, whose entries take a click.
- Assistive-technology activation of another control while a popup is
  open activates it (only a pointer press outside is swallowed).
- `apps/gallery/tests/popups.test` opens, picks by pointer and keys,
  closes with Escape and with a press outside, on the web and the native
  build.
