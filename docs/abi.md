# ceangal2 host ABI (v1)

One contract between an Almide program built on ceangal/snaidhm (the **guest**)
and whatever runs it (the **host**). Three hosts implement it:

| Host | Guest form | Where |
|---|---|---|
| JS | wasm module, imports wired by `hosts/web/host.js` | browsers (playground itself, and user GUI programs in a Worker) |
| Rust, direct | native code; `@extern(rust, "crate::<ns>", …)` resolve to `ceangal/native/*.rs`, `snaidhm/native/*.rs` | desktop / mobile builds of an app |
| Rust, wasm shim | wasm module run by the embedded runtime; imports forward to the same Rust implementation | user GUI programs inside the native playground |

Every binding is declared once in Almide with both spellings:

```almide
@extern(wasm, "gpu", "create_buffer")
@extern(rust, "crate::gpu", "create_buffer")
fn create_buffer(size: Int, usage: Int) -> Int = _
```

## 1. Value conventions

* **Only `Int` (i64) and `Float` (f64) cross the boundary.** No String, Bytes,
  List or record ever appears in an extern signature. This keeps the three
  hosts identical and independent of the compiler's heap layout.
* **Handles** are `Int`. `0` is the null handle and is never a live object.
  A handle is valid only inside the context that created it (§3).
* **Byte ranges** are `(ptr: Int, len: Int)` where `ptr = bytes.data_ptr(b)`.
  On wasm `ptr` is an offset into the guest's linear memory; natively it is a
  real address. The host reads exactly `len` bytes and never retains `ptr`
  past the call.
* **Strings** are UTF-8 byte ranges (`bytes.from_string(s)`).
* **Host → guest data uses pull, never host allocation.** The host exposes
  `<x>_len() -> Int`; the guest allocates `bytes.new(n)` and calls
  `<x>_read(ptr, n)`, which fills the buffer and returns the byte count.
  (The guest is the only allocator of its own heap.)
* **Booleans** are `Int` 0/1. **Enums** are small `Int`s listed below.
* **Coordinates** given to the guest are logical pixels (CSS px / points) as
  `Float`; `scale` converts to physical pixels. GPU calls take physical pixels.

## 2. Guest entry point

The guest's root module exports exactly one dispatcher; the boilerplate is a
single line every app carries (wasm exports only root-module functions):

```almide
@export(wasm, "ceangal_event")
fn ceangal_event(kind: Int, a: Int, b: Int, x: Float, y: Float, z: Float, w: Float) -> Int =
  ceangal.dispatch(kind, a, b, x, y, z, w)
```

Natively the host calls `ceangal.dispatch` directly (the generated Rust name,
aliased once in `ceangal/native/host.rs`), so the line is wasm-only in effect.

Startup: the host runs the program's `main` (wasm `_start`). `main` calls
`ceangal.run(app)`, which stores the app record and calls `sys.run()`. A host
that owns the event loop (native) never returns from `sys.run()`; the JS host
returns immediately and drives the loop from `requestAnimationFrame` and DOM
events, calling `ceangal_event`.

| kind | event | a | b | x | y | z | w | result |
|---|---|---|---|---|---|---|---|---|
| 1 | init | – | – | width | height | scale | – | 0 |
| 2 | resize | – | – | width | height | scale | – | 0 |
| 3 | frame | – | – | time ms | – | – | – | 1 = wants another frame |
| 4 | pointer | phase (§2.1) | pointer id | x | y | buttons | mods | 1 = handled |
| 5 | wheel | mods | 0 line / 1 pixel | x | y | dx | dy | 1 = handled |
| 6 | key | 0 down / 1 up / 2 repeat | key code (§2.2) | mods | – | – | – | 1 = handled |
| 7 | text | 0 commit / 1 preedit / 2 preedit end / 3 paste | preedit cursor (bytes) | – | – | – | – | 1 = handled |
| 8 | focus | 0 lost / 1 gained | – | – | – | – | – | 0 |
| 9 | lifecycle | 0 paused / 1 resumed / 2 low memory / 3 will terminate | – | – | – | – | – | 0 |
| 10 | async result | request id (§4.6, §4.7) | status | – | – | – | – | 0 |
| 11 | appearance | 0 light / 1 dark | – | safe top | safe right | safe bottom | safe left | 0 |
| 12 | a11y action | node id | action (§4.4) | – | – | – | – | 1 = handled |

Text-bearing events (7, 10, and file results) carry their payload in the
**event data buffer**: `sys.event_len()` / `sys.event_read(ptr, len)`, valid
until the dispatcher returns.

### 2.1 Pointer phases
`0 down, 1 move, 2 up, 3 cancel, 4 enter, 5 leave`. `buttons` is a bit set
(`1 primary, 2 secondary, 4 middle`). Touch uses the same events with
`pointer id >= 1` per finger; mouse is id `0`.

### 2.2 Keys and modifiers
`mods` bits: `1 shift, 2 ctrl, 4 alt, 8 meta(cmd/win)`. `shortcut` (ctrl on
Linux/Windows, meta on Apple) is resolved by ceangal, not the host.

Key codes are layout-independent physical names for control keys; printable
characters arrive as text events, not keys:

```
1 Enter  2 Tab  3 Backspace  4 Delete  5 Escape
10 Left  11 Right  12 Up  13 Down  14 Home  15 End  16 PageUp  17 PageDown
20 A (with shortcut: select all)  21 C  22 V  23 X  24 Z  25 Y  26 S  27 F  28 O  29 N  30 W
40..51 F1..F12   60 Space
```
Letters are reported as keys only together with ctrl/meta, so shortcuts work
on every layout.

## 3. Contexts

A **context** is one guest instance plus every handle it owns. The playground
and each user GUI program run in separate contexts; destroying a context
releases all of its GPU objects, timers and pending requests at once (this is
how Stop works). On wasm the context is the instance. Natively the host sets
the current context (thread-local) before calling `ceangal.dispatch`, and the
`@extern(rust)` functions act on it.

## 4. Imports

### 4.1 `sys`
| fn | signature | notes |
|---|---|---|
| `run` | `() -> Unit` | enter the host loop (§2) |
| `request_frame` | `() -> Unit` | schedule a frame event |
| `now_ms` | `() -> Float` | monotonic |
| `log` | `(ptr, len) -> Unit` | debug output |
| `event_len` / `event_read` | `() -> Int` / `(ptr, len) -> Int` | event data buffer |
| `platform` | `() -> Int` | `1 web, 2 macos, 3 windows, 4 linux, 5 ios, 6 android`; `17` = web on an Apple OS (Cmd is the shortcut key) |
| `set_cursor` | `(kind) -> Unit` | `0 default, 1 text, 2 pointer, 3 grab, 4 resize-ew, 5 resize-ns` |
| `set_title` | `(ptr, len) -> Unit` | |
| `open_url` | `(ptr, len) -> Unit` | external browser |
| `asset_len` | `(name_ptr, name_len) -> Int` | bundled read-only files; `-1` if absent |
| `asset_read` | `(name_ptr, name_len, dst_ptr, dst_len) -> Int` | |
| `exit` | `(code) -> Unit` | |

### 4.2 `gpu` — WebGPU subset
One implicit command encoder per frame. All sizes are physical pixels/bytes.

| fn | signature |
|---|---|
| `surface_format` | `() -> Int` (format enum) |
| `create_shader` | `(src_ptr, src_len) -> Int` (WGSL) |
| `create_render_pipeline` | `(shader, vs_ptr, vs_len, fs_ptr, fs_len, format, blend) -> Int` |
| `create_buffer` | `(size, usage) -> Int` |
| `write_buffer` | `(buffer, offset, ptr, len) -> Unit` |
| `create_texture` | `(width, height, format, usage) -> Int` |
| `write_texture` | `(texture, x, y, width, height, ptr, len, bytes_per_row) -> Unit` |
| `create_sampler` | `(filter) -> Int` (`0 nearest, 1 linear`) |
| `bind_begin` | `() -> Unit` |
| `bind_buffer` / `bind_texture` / `bind_sampler` | `(binding, handle) -> Unit` |
| `bind_create` | `(pipeline, group) -> Int` |
| `frame_begin` | `() -> Int` (render target for this frame, `0` = skip frame) |
| `target_width` / `target_height` | `(target) -> Int` |
| `pass_begin` | `(target, load, r, g, b, a) -> Int` (`load`: 0 clear, 1 keep) |
| `pass_pipeline` | `(pass, pipeline) -> Unit` |
| `pass_bind` | `(pass, index, group) -> Unit` |
| `pass_scissor` | `(pass, x, y, width, height) -> Unit` |
| `pass_draw` | `(pass, vertices, instances, first_vertex, first_instance) -> Unit` |
| `pass_end` | `(pass) -> Unit` |
| `frame_submit` | `() -> Unit` (submit + present) |
| `release` | `(handle) -> Unit` |
| `external_texture` | `(context_id) -> Int` (texture of another context's offscreen target; §5) |

Enums: format `1 bgra8unorm, 2 rgba8unorm, 3 r8unorm`; usage bits as WebGPU
(`buffer: COPY_DST 8, UNIFORM 64, STORAGE 128`; `texture: COPY_SRC 1,
COPY_DST 2, TEXTURE_BINDING 4, RENDER_ATTACHMENT 16`); blend `0 none,
1 premultiplied alpha`. Pipelines use `layout: auto`, triangle-list, no vertex
buffers (vertex shaders pull from storage buffers by `instance_index`).

### 4.3 `text_input` — IME and soft keyboard
| fn | signature | notes |
|---|---|---|
| `ime_begin` | `(x, y, w, h) -> Unit` | caret rect, logical px; shows the soft keyboard on mobile |
| `ime_update` | `(x, y, w, h) -> Unit` | caret moved |
| `ime_end` | `() -> Unit` | hide |
Committed and composing text arrives as event 7.

### 4.4 `a11y`
Retained tree, rebuilt by ceangal after layout:
`a11y_begin()`, `a11y_node(id, parent, role, x, y, w, h, flags, label_ptr, label_len)`,
`a11y_value(id, ptr, len)`, `a11y_commit(focus_id)`.
`a11y_active() -> Int` is 1 while something consumes the tree (the web ARIA
overlay always; native once an assistive technology connects); ceangal skips
building the tree while it is 0.
Roles `1 window, 2 group, 3 button, 4 text, 5 text field, 6 list, 7 list item, 8 tab, 9 tab list, 10 heading, 11 link, 12 checkbox, 13 image, 14 code editor`.
Flags `1 focusable, 2 focused, 4 selected, 8 checked, 16 disabled`.
Actions (event 12) `1 click, 2 focus, 3 increment, 4 decrement, 5 scroll into view`.

### 4.5 `clipboard`
`clipboard_write(ptr, len)`. Paste arrives as event 7 with `a = 3` (the host
reads the clipboard in response to the paste gesture).

### 4.6 `storage` — per-app key/value
`storage_len(key_ptr, key_len) -> Int` (`-1` absent), `storage_read(key_ptr,
key_len, dst_ptr, dst_len) -> Int`, `storage_write(key_ptr, key_len, ptr,
len)`, `storage_remove(key_ptr, key_len)`. Values are bytes. Secrets (API
keys) use `secret_*` with the same shape; hosts back them with
Keychain / Keystore / Credential Manager / libsecret / `localStorage`.

### 4.7 `net` and `file` — async requests
Each returns a request id; completion arrives as event 10 with the body in the
event data buffer.
* `http_begin(method_ptr, method_len, url_ptr, url_len) -> Int`,
  `http_header(id, name_ptr, name_len, value_ptr, value_len)`,
  `http_send(id, body_ptr, body_len)`. Streaming bodies arrive as several
  event-10s with `status = 1000 + http status` per chunk and the final one
  with the plain status (`0` and the error text if the request failed).
  `http_cancel(id)` aborts a request; nothing more is delivered for it.
* `file_open(kind) -> Int` (system picker; `kind` 0 text), `file_save(name_ptr,
  name_len, ptr, len) -> Int`.

### 4.8 `runner` — the playground's compiler service (app-specific)
Defined in `apps/playground/docs/runner.md`; the web host implements it with
the compiler wasm in a Worker, the native host with the compiler crate.

## 5. User GUI programs inside the playground

A user GUI program is a second context running the same ABI. Its
`frame_begin` target is an offscreen texture the host allocates at the size of
the playground's Visual panel. The playground draws that texture with
`gpu.external_texture(context_id)` (native: same `wgpu::Device`, zero-copy).
On the web the user context lives in a Worker with its own `GPUDevice` and an
`OffscreenCanvas` overlaid on the panel rectangle, so `external_texture`
returns `0` there and the playground leaves the rectangle transparent.
Pointer/key/text events inside the panel are forwarded to the user context
translated to panel coordinates. Limits: GPU objects per context, a frame-time
watchdog, and fuel per dispatched event; exceeding any ends the context like
Stop.

## 6. Versioning

`sys.abi_version()` returns `1`. Additive changes keep the number; any change
to an existing signature or enum value bumps it, and ceangal refuses to start
on a mismatch with a visible message.
