# ADR 0020 — Virtual lists

## Context
A view tree is rebuilt, laid out and painted every frame. A list of
thousands of rows did all three for every row, on screen or not.

## Decision
- **`w.virtual_list(th, key, count, row_h, row)`** is a `scroll_y` view
  that builds rows only between the scroll offset and one window height
  below it, plus four rows on each side. Two empty spacers stand for the
  rows above and below, so the scroll height, the scroll bar and the wheel
  or finger scrolling behave as for the whole list.
- **Rows have one height (`row_h`).** That keeps the visible range
  arithmetic: no measuring, and no jumps while scrolling. Lists with rows
  of different heights stay ordinary columns.
- **`ceangal.scroll_offset(key)`** exposes the offset the runtime keeps
  for a `scroll_y` view. The list's height comes from `rect_of(key)` of the
  last frame, or 800 px before the first.
- **Accessibility**: the list is a list (role 6) labelled "N items". Only
  the built rows are in the tree, as with the platforms' own virtualized
  lists. A screen reader user scrolls the list to reach more.

## Consequences
- `apps/gallery` shows 10,000 rows. `longlist.test` (web and native)
  checks that rows far down aren't built. The Chrome E2E scrolls 100 rows
  down by wheel and finds row 101, with 15 rows built.
- Keyboard focus can't move to a row that isn't built. Lists whose rows
  take focus need to scroll the next row into view themselves.
