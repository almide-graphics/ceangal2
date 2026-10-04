# ADR 0002 — ceangal owns the accessibility tree; hosts consume it lazily

Date: 2026-10-04 · Status: accepted

## Context
Every pixel comes from snaidhm, so no platform widget exists for a screen
reader to inspect. The ABI already carried an `a11y` namespace (`a11y_begin`,
`a11y_node`, `a11y_value`, `a11y_commit`) but nothing produced the tree.
Building it walks every view each frame; on the native leg, reading an
editor's text copies its whole buffer, which took the 10k-line scroll bench
from 6.5 ms to 30 ms a frame.

## Decision
- ceangal emits the tree after layout from what views already carry: `role`,
  `label` (text views announce their content), the new `value` accessor
  (editors expose the lines on screen plus a margin), focus and focusability.
  Node ids are frame indices + 1; the tree is flat for now.
- Values are refreshed at most every 250 ms (and on every focus change), with
  one trailing frame so the last change is never lost.
- `a11y_active() -> Int` tells ceangal whether anything consumes the tree. The
  web host answers 1 (the ARIA overlay is always there; headless E2E tests use
  the same tree). Native answers 1 once an AccessKit adapter activates (M4) or
  when `CEANGAL_A11Y=1`.
- Event 12 actions 1 (click) and 2 (focus) are routed to `on_click` / `focus`.

## Consequences
- Screen readers and tests address the UI by what is announced ("Run",
  "Program output"), so labels are part of an app's contract.
- Native pays nothing until an assistive technology connects.
- Hierarchy (parent ids) and the remaining actions are follow-ups.
