# ADR 0019 — Context menus: right-click and long press

## Context
Desktop users expect a right-click menu on rows and items. Phone users
expect the same menu after a long press. ceangal saw a right-click as an
ordinary press, so it also ran the click. On the web, the browser's own
menu was suppressed. Touch had no notion of holding.

## Decision
- **`v.on_context(f)`**: `f(x, y)` runs, with the point in window logical
  px, in two cases:
  - a right-click on the view (button bit 2 in the pointer event, which
    the web host and winit already report);
  - a touch held still (within 10 px) for 0.5 s. The runtime notes the
    touch when it starts on a view that has a context handler, and asks
    for a frame at 0.5 s, which fires it.

  The topmost view with a handler wins, overlays first. The gesture
  doesn't otherwise count as a press: a right-click's release, and the
  rest of a long-pressed touch, do nothing (no click, no scroll).
- **`ceangal.open_popup_at(key, index, x, y)` / `popup_point()`** open a
  popup at a point. The one-popup rules of ADR 0013 still apply.
- **`w.context_menu(th, key, items, view)`** wraps `view`. On a context
  gesture it opens `items` at the point, using the same card and entries
  as `w.menu_button` (roles menu / menu item). Near the window's right or
  bottom edge it opens leftward or upward. The menu takes focus while it
  is open, so the menu keys work (arrows, Home / End, Enter, Escape).
  A click on an entry runs it; a press outside closes the menu.
- **`ceangal test` gets a `context "Label"` step** (a right-click) on the
  web and natively. The Chrome E2E long-presses with CDP touch events.

## Consequences
- `apps/gallery` puts a context menu on its Archive row:
  - `popups.test` opens it by right-click, picks an entry and closes it
    with Escape, on the web and natively;
  - `tests/e2e/gallery.mjs` checks the long press, that its release does
    not tap the row, and the menu items' role.
- The keyboard's context-menu key and Shift+F10 don't open it yet. A
  focused control could offer the same menu; that comes with the
  keyboard map's next extension.
  **Update (2026-10-06):** done.
  - Key code 61 is the menu key (`ContextMenu` on the web, winit's
    `NamedKey::ContextMenu` natively).
  - That key, or Shift+F10, runs the context handler of the focused view,
    or else of the nearest view around it that has one. The menu opens at
    the focused view's lower left.
  - The web host also blocks the browser's own menu on its key sink.
  - `ceangal test` knows `key Menu` and `key Shift+F10`. `popups.test`
    opens the Archive row's menu both ways and picks an entry with the
    arrows and Enter, on the web and natively.
- Long press is now available for touch tooltips (ADR 0018) as well.
