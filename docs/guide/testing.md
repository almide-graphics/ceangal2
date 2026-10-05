# Testing

An app's tests are text files in `tests/`, one step per line. Each step
finds views by their accessible labels, the way a screen reader (and a
user reading the screen) does:

```
# tests/tasks.test
see "1 task left"
tap "New task"
type "Buy milk"
key Enter
see "Buy milk"
see "2 tasks left"
tap "Clear completed"
not "Buy milk"
```

```sh
ceangal test            # every tests/*.test, on the web build and the native build
ceangal test web        # only the web build, in headless Chrome
ceangal test native     # only the native build, headless (no window)
ceangal test tests/tasks.test
```

| step | |
|---|---|
| `tap "Label"` | press and release on the view with that label (scrolled into view first on the web) |
| `type "text"` | type into the focused view (a text field gets focus when tapped) |
| `key Enter` | a key: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, arrows (`Left`, `Right`, `Up`, `Down`), `Home`, `End`, `PageUp`, `PageDown`, `Space`; with modifiers as `Shift+Tab`, `Ctrl+A`, `Cmd+Z` |
| `see "text"` | some view's label or value contains the text (the web runner waits up to 5 s for it) |
| `not "text"` | no view's label or value contains it |
| `wait 500` | let 500 ms pass |
| `shot "name.png"` | a screenshot |

Lines starting with `#` are comments. A failing step stops the file and
prints the line, what was expected, and every label on screen:

```
FAIL tests/tasks.test:6: see "2 tasks left"
     "2 tasks left" is not on screen
     on screen: ["Todo", "New task", "Buy milk", "1 task left", …]
```

Screenshots of the last state of each file (and the `shot` steps) go to
`build/test/web` and `build/test/native`.

## Labels

A test can only reach what has a label. That is the same rule screen
readers have, so a test that cannot find a button usually means a screen
reader cannot either. Text views are labelled with their text. The
[standard controls](ui.md#controls) label themselves. A view you build
yourself needs `v.label("…")` (and a `v.role`).

Values count too: a slider reads as `Volume = 40` and a text field as its
text, so `see "Volume = 40"` works.

## In CI

`.github/workflows/app.yml` runs `ceangal test web` in its web job and
`ceangal test native` in its macOS job when the app has tests. `ceangal
new` writes `tests/count.test` for the counter it starts with.

## What runs where

The web runner drives the real page in headless Chrome: pointer, keys
and typing go through the browser and the web host, as a user's would.
The native runner drives the native build without a window, through the
same entry point the platform hosts use. Phone builds run the same app
code. This repository's own end-to-end tests cover the iOS and Android
hosts in a simulator and an emulator (tests/e2e/ios, tests/e2e/android.mjs).
