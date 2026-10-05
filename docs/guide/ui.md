# Building UI

## The model

An app is a `view()` function from its state to a tree of views:

```almide
var count = 0

fn view() -> v.View =
  v.col([
    v.text(int.to_string(count)),
    v.text("Add") |> v.on_click(() => { count = count + 1 }),
  ])
```

State is ordinary top-level `var`s (or a record in one). Event handlers
change it. After every handled event, ceangal calls `view()` again, lays
the tree out and draws it. There is no diffing to think about and no
widget objects to keep: a view is a value built fresh each frame.

`ceangal.run(ceangal.app(view))` starts the app. The app record can carry
more handlers: [`ceangal`](../api/ceangal.md) has `background`, `on_key`,
`on_text`, `on_frame` and `on_result`.

Two things every app file has, both because of open Almide issues:

```almide
// A function called only from inside a closure must also be referenced at
// the top level, or the wasm build drops it (almide/almide#3296):
fn add() -> Unit = { count = count + 1 }
let keep_add = add

// The web host calls into the app through this export:
@export(wasm, "ceangal_event")
fn ceangal_event(kind: Int, a: Int, b: Int, x: Float, y: Float, z: Float, w: Float) -> Int =
  ceangal.dispatch(kind, a, b, x, y, z, w)
```

## Views

```almide
import ceangal.view as v
```

| | |
|---|---|
| `v.text(s)` | one line of text (or a paragraph, with `v.wrap_row`) |
| `v.col([…])`, `v.row([…])` | stack children vertically / horizontally |
| `v.wrap_row([…])` | a row that continues on further lines when full |
| `v.box(child)`, `v.empty()` | a container; an empty box (a swatch, a divider) |
| `v.spacer()` | takes the free space in a row or column |
| `v.custom(key, paint)` | draws itself (see [Drawing](#drawing)) |

Every modifier takes a view and returns a new one, so they chain with `|>`:

```almide
v.text("Save") |> v.font(15.0) |> v.bold() |> v.color(WHITE)
  |> v.px(16.0) |> v.py(8.0) |> v.rounded(8.0) |> v.bg(ACCENT)
```

Build views with ordinary functions; a component is a function that
returns a view:

```almide
fn button(title: String, on: () -> Unit) -> v.View =
  v.text(title) |> v.px(16.0) |> v.py(8.0) |> v.rounded(8.0) |> v.bg(ACCENT)
    |> v.on_click(on) |> v.role(3) |> v.label(title)
```

## Controls

`ceangal.widgets` has the standard controls, styled by one theme:

```almide
import ceangal.widgets as w

fn view() -> v.View = {
  let th = w.system()            // w.light(), w.dark(), or your own Theme
  w.card(th, [
    w.heading(th, "Settings"),
    w.switch(th, "Notifications", notify, (on) => set_notify(on)),
    w.checkbox(th, "Remember me", remember, (on) => set_remember(on)),
    w.radio_group(th, "Size", ["Small", "Medium", "Large"], size, (i) => set_size(i)),
    w.slider(th, "Volume", volume, 0.0, 100.0, 5.0, (x) => set_volume(x)),
    w.text_field(th, "name", "Name", () => name, (e) => set_name(e)),
    v.row([w.secondary_button(th, "Cancel", () => cancel()), w.button(th, "Save", () => save())]) |> v.gap(10.0),
  ])
}
```

| | |
|---|---|
| `button`, `secondary_button`, `danger_button`, `text_button`, `button_enabled` | actions |
| `checkbox`, `switch`, `radio_group`, `segmented` | choices |
| `slider`, `progress` | values |
| `text_field` | text entry (holds an `ed.Editor`) |
| `title`, `heading`, `body`, `caption`, `link` | text |
| `card`, `divider`, `list_item`, `dialog` | containers |

Every control can be reached with Tab and activated with Enter or Space;
arrows move radio groups, segments and sliders. Each shows a focus ring,
reacts to hover and press, and tells screen readers its role, label and
state (checked, selected, unavailable, a slider's value). Controls hold
no state of their own: pass the current value in and update it in the
callback. A control's key, which focus and hover go by, comes from its
label, so the controls on one screen need distinct labels (which screen
readers need anyway).

[apps/gallery](../../apps/gallery/src/main.almd) shows every control,
and [`ceangal.widgets`](../api/ceangal.widgets.md) lists them all. For
your own controls, `ceangal.is_hovered(key)` and `ceangal.is_pressed(key)`
give the pointer state, and `v.checked`, `v.selected` and `v.disabled`
the state screen readers announce.

## Layout

Layout is flexbox: a column or row places its children along its axis.

| | |
|---|---|
| `gap(g)` | space between children |
| `padding(all)`, `px(x)`, `py(y)`, `pad(t, r, b, l)` | space inside |
| `margin(all)`, `mx`, `my` | space outside |
| `w`, `h`, `size(w, h)`, `w_pct`, `h_pct`, `fill()` | size (logical px, percent, all of the parent) |
| `min_w`, `min_h`, `max_w`, `max_h` | bounds |
| `grow(g)`, `shrink(s)` | take free space / give way when short |
| `justify(v.Start / End / Center / Between / Around / Evenly)` | distribution along the axis |
| `align(v.Top / Bottom / Middle / Stretch)`, `align_self(…)` | alignment across it |
| `center()` | both, centred |
| `absolute() |> top(t) |> right(r) …` | out of the flow, positioned in the parent |
| `clip()` | children do not draw outside |

Sizes are logical pixels: the same physical size on every screen.
`ceangal.viewport_width()` / `viewport_height()` give the space the app
has (inside phones' safe areas), so `view()` can choose a layout:

```almide
fn view() -> v.View =
  if ceangal.viewport_width() < 600.0 then phone_layout() else wide_layout()
```

## Style

`bg(c)`, `color(c)` (text), `rounded(r)`, `border(width, c)`,
`shadow(blur, dy, c)`, `opacity(o)`, `font(size)`, `bold()`, `mono()`.
Colours come from `snaidhm`: `snaidhm.hex(0x7AA2F7)`,
`snaidhm.rgba(r, g, b, a)` (0–1), `snaidhm.with_alpha(c, a)`.

`ceangal.is_dark()` is the system appearance. It can change while the app
runs, and the app redraws when it does, so a palette chosen in `view()`
follows it:

```almide
fn ink() -> snaidhm.Color = if ceangal.is_dark() then snaidhm.hex(0xE6E8F0) else snaidhm.hex(0x1A1B26)
```

`ceangal.set_background(c)` changes the colour behind everything,
including under the safe areas.

Text is drawn with the bundled fonts: a UI sans (regular and semibold), a
monospace font for `mono()`, and a CJK font that covers Japanese, Chinese
and Korean in any style.

## Input

### Clicks and pointers

`on_click(f)` runs `f` on a click or a tap. `on_pointer(f)` receives
every pointer event over the view (`v.Pointer`: phase 0 down, 1 move,
2 up, 3 cancel, 4 enter, 5 leave; x/y relative to the view) and returns
true to claim it (drags, sliders). `on_wheel(f)` receives scroll deltas.
`cursor(kind)` sets the mouse cursor over the view.

### Text fields

Text entry is an editor from `ceangal.editor`: its state is an
`ed.Editor` value you keep, and `ed.field` (one line) or `ed.view`
(multi-line, with optional syntax highlighting) shows it:

```almide
import ceangal.editor as ed

var name = ed.text_field("", "Your name")       // text, placeholder
fn set_name(e: ed.Editor) -> Unit = { name = e }
let keep_set_name = set_name

fn view() -> v.View =
  v.col([
    ed.field("name", () => name, (e) => set_name(e), ed.light_theme())
      |> v.h(40.0) |> v.rounded(8.0) |> v.clip() |> v.label("Name"),
    v.text("Hello, " + ed.to_string(name)),
  ])
```

The editor does selection, copy and paste, undo, IME composition (Japanese
and other input methods) and, on phones, the on-screen keyboard. Read the
text with `ed.to_string`, replace it with `ed.set_text`, and see
[`ceangal.editor`](../api/ceangal.editor.md) for the rest (`with_secret`
for passwords, `with_syntax`, `with_read_only`, `log` for an output
pane…).

### Keys and focus

A view with a key (`focusable(k)`, or an editor) can hold keyboard focus.
Tab moves between them, and `ceangal.focus(k)` moves focus from code.
`on_key((phase, code, mods) => …)` on a view, or on the app, receives
keys:

```almide
ed.field("new", () => field, (e) => set_field(e), theme)
  |> v.on_key((phase, code, mods) => if phase != 1 and code == 1 then { add(); true } else false)
```

Phase 0 is down, 1 up and 2 repeat. Key codes: 1 Enter, 2 Tab,
3 Backspace, 4 Delete, 5 Escape, 10–13 arrows, 14 Home, 15 End, 16/17
Page Up/Down, 40–51 F1–F12, 60 Space, and letters with a shortcut
modifier (20 A, 21 C, 22 V, 23 X, 24 Z, 26 S, …; [the full
table](../abi.md)). Typed characters arrive as text, not keys.
`ceangal.is_shortcut(mods)` is Cmd on Apple platforms and Ctrl elsewhere.

On phones and tablets the on-screen keyboard opens when the user taps a
text field, not when code focuses one. `ceangal.soft_keyboard()` tells
whether it is up, for example to show a row of extra keys above it, with
`v.keeps_focus()` so tapping them leaves the field focused.

## Scrolling

```almide
v.col(rows) |> v.scroll_y("list") |> v.grow(1.0)
```

A `scroll_y` view scrolls its content when it is taller than the view.
Give it a height, or `grow` in a column of fixed height. Mouse wheels,
trackpads and touch drags (with momentum) scroll it. The key keeps the
position across frames. `ceangal.scroll_to_end(key)` follows a growing
list such as a log or a chat.

## Accessibility

Screen readers see the views you describe: VoiceOver on macOS, Narrator
on Windows, Orca on Linux (through AccessKit), and any reader on the web
(through an ARIA overlay). iOS VoiceOver and Android TalkBack do not see
ceangal apps yet: AccessKit has no adapter for them that ceangal can use.

```almide
v.text("×") |> v.on_click(() => remove(id)) |> v.role(3) |> v.label("Remove " + title)
```

`role(r)`: 3 button, 4 text, 5 text field, 6 list, 7 list item, 8 tab,
9 tab list, 10 heading, 11 link, 12 checkbox, 13 image, 15 switch,
16 slider, 17 dialog, 18 radio button, 19 radio group, 20 progress bar.
`checked(on)`, `selected(on)`, `disabled(on)` add the state. The
standard controls set all of this themselves. `label(s)` is
what is read. `value(f)` gives a changing value (a field's text).
`a11y_hidden()` leaves out a view whose parent already speaks for it.
Text is read as text without any of this. Anything you can click needs a
role and a label, or a reader cannot tell it is a button, and anything
that shows only an icon needs a label.

Tests use the same tree: CI clicks labels in the web build
(`tests/e2e/smoke_web.mjs --click LABEL`).

## Animation

`ceangal.app(view) |> ceangal.on_frame((t) => …)`: called every frame
with the clock in ms while it returns true. Return false when the
animation is done, so the app goes back to drawing only on input. To
redraw after state changes from outside an event (a result, a timer),
call `ceangal.invalidate()`.

## Beyond views

| | |
|---|---|
| [`ceangal.storage`](../api/ceangal.storage.md) | `get` / `set` / `remove` small strings that survive restarts; `secret_*` for tokens and keys (Keychain, Keystore, Credential Manager, libsecret) |
| [`ceangal.http`](../api/ceangal.http.md) | `get`, `post_json`, `request`: the answer arrives in `on_result` (set `network = true`) |
| `ceangal.asset(path)`, `asset_text(path)` | files bundled with the app (`[app] assets`) |
| `ceangal.copy_text(s)` | the system clipboard, on every platform (paste arrives as text in the focused field) |
| `ceangal.open_url(url)` | the system browser |
| `ceangal.save_file(name, bytes)`, `open_text_file()` | save and open: the save / open panels on the desktop, a download and a file picker on the web, the share sheet and the document picker on iOS, the shared Downloads folder on Android (no picker there yet); the result arrives in `on_result` |
| `ceangal.set_title(s)` | the window's title |

Requests (`http`, files) return an id at once. The answer comes later,
to the app's `on_result` handler:

```almide
var req = -1
var status = "…"

fn refresh() -> Unit = { req = http.get("https://api.example.com/today") }
fn result(id: Int, code: Int, body: Bytes) -> Unit =
  if id == req then status = if code == 200 then bytes.to_string_lossy(body) else "failed" else ()

effect fn main() -> Unit =
  ceangal.run(ceangal.app(view) |> ceangal.on_result((id, code, body) => result(id, code, body)))
```

(Pass `result` through a lambda as here. Using a top-level function with
a `Bytes` parameter as a value does not compile natively yet,
almide/almide#3419.)

Anything else (a sensor, a native SDK) is a [native extension](native.md).

## Drawing

`v.custom(key, paint)` is a view that draws itself with `snaidhm`.
`paint(x, y, w, h)` receives its laid-out rectangle in logical pixels.
snaidhm draws in physical pixels, so multiply by `ceangal.pixel_scale()`:

```almide
fn dot(c: snaidhm.Color) -> v.View =
  v.custom("dot", (x, y, w, h) => {
    let k = ceangal.pixel_scale()
    let r = float.min(w, h) / 2.0 * k
    snaidhm.fill((x + w / 2.0) * k - r, (y + h / 2.0) * k - r, r * 2.0, r * 2.0, r, c)
  }) |> v.size(24.0, 24.0)
```

[`snaidhm`](../api/snaidhm.md) has rounded rectangles (`fill`, `stroke`,
`shadow`), images (`create_image`, `image`) and clipping;
[`snaidhm.vector`](../api/snaidhm.vector.md) has paths.

## A larger app

Split the program into modules: `import self.state as st` reads
`src/state.almd`. The [Todo app](../../apps/todo/src/main.almd) is one
file. The [playground](../../apps/playground/src) is a full app with
state, UI, an editor, tabs, settings, network and storage.
