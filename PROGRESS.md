# PROGRESS

Read at the start of every session; update at the end.

## Current milestone

**M4 — desktop** (M0–M3 done locally). M2's last item, the first green CI
run on main that deploys Pages, waits for a push (see Blockers).

## Done

### M0 — ABI (2026-10-04)
- `docs/abi.md` host ABI v1; `tools/gen_bindings.py` generates every binding
  module and `abi/manifest.json` (72 functions now); `tests/abi_conformance.mjs`
  checks both hosts implement all of them with matching signatures.
- snaidhm: one WGSL program, instanced quads (fill / stroke / shadow / glyph /
  image), clip stack, image batches; `native/gpu.rs` on wgpu 30 with per-context
  handle tables, surface or offscreen target, readback, external textures.
- ceangal runtime: closure-based views, flex layout (74 Yoga tests), paint,
  hit testing, dispatch. Native host (winit + headless scripted mode) and web
  host (WebGPU, DOM events, hidden-textarea IME, ARIA overlay, storage, fetch).

### M1 — text and editor (2026-10-04)
- Font engine in Almide (`snaidhm/src/font.almd`): TrueType cmap 4/12, glyf
  simple + composite, coverage rasteriser, shelf-packed R8 atlas; fallback
  chain ui → cjk → mono. Bundled OFL fonts subset by `tools/build_fonts.py`.
- `ceangal/src/editor.almd`: code editor + text field (selection, undo/redo,
  IME preedit, clipboard, diagnostics, gutter, Almide syntax highlighting).
- Pixel parity web vs native: max diff 0 on every case; 10k-line scroll bench
  p95 ≈ 4.5 ms web, ≈ 9 ms native (budget 16.7 ms).

### M2 — playground on the web (in progress)
- `apps/playground`: tabs (add / rename / close), Run / Stop with streamed
  stdout, check-on-idle diagnostics (squiggles + problems strip), Output /
  Visual (PPM, SVG via `snaidhm/src/vector.almd`, simple HTML) / Rust / AST,
  examples menu, share links (`#code=` raw deflate, pure `src/deflate.almd`),
  persistence, launch params (`?example=`, `?embed=1`, `?hide=`, `?autorun=1`),
  narrow (phone) layout, export as a runnable zip (`src/zip.almd`).
- AI assistant (BYOK, `src/ai.almd`): Claude / OpenAI / Gemini, SSE streamed
  into the active tab over the `net` ABI, three-attempt repair loop with a diff
  log (AI tab), "Fix with AI" after a failed run, key in secret storage and
  shown masked (`ed.with_secret`). System prompt: `assets/ai/system.md`.
- Native host: async results (`sys::post_result` / `finish_async`, event-loop
  waker, headless `wait`), real HTTP (`ureq`, streamed, `http_cancel`), file
  dialogs (`rfd`; headless `CEANGAL_DOWNLOADS` / `CEANGAL_OPEN_FILE`).
- Compiler service: `apps/playground/compiler` (the almide crate at v0.66.0,
  wasm-bindgen) in a Worker (`hosts/web/runner-worker.js`) with a WASI shim.
- Accessibility: ceangal emits a flat a11y tree (role, label, value, focus)
  when `a11y_active()`; the web ARIA overlay always consumes it. E2E tests
  drive the app through it.
- `tools/build_web.sh` → `dist/web`. `tests/wasm_stubs.mjs` fails the build if a
  closure body was compiled to an `exit(1)` stub (see #3296 below).
- Tests: `tests/e2e/web.mjs` (16 steps: boot, run, check, compile error, stop,
  examples, visual, Rust/AST, tabs, export zip, share, share link, embed, phone
  layout, AI generate + repair against a mocked provider, AI stop + fix) and
  `tests/e2e/fixtures.mjs` (11 old-playground fixtures + 18 examples, native
  CLI vs the in-browser compiler: 22 byte-identical, 7 random ones run OK).
- CI: `web` job (macOS, real Chrome WebGPU) builds everything, runs both E2E
  suites, uploads screenshots, and deploys `dist/web` to Pages on main.

### M3 — user GUI on the web (2026-10-04)
- The compiler service embeds `ceangal` and `snaidhm` (build.rs, `import self.x`
  rewritten to `import <pkg>.x` since provided modules carry no package id) and
  resolves them for user programs; `apps/todo` is the demo, also the "Todo app"
  example (CI checks the two are identical).
- Programs exporting `ceangal_event` run as a window over the Visual pane:
  `hosts/web/gui.js` (page side, DomUi) + `gui-worker.js` (Worker, own
  GPUDevice, OffscreenCanvas, in-memory storage, handle/texture limits,
  watchdog). host.js is split: `dom.js` holds every DOM concern.
- Tests: `tests/e2e/web.mjs` "user GUI" step (real CDP input into the program
  window: type Japanese, Enter, toggle, remove, Stop) and `tests/e2e/page.mjs`
  (the real index.html: boot, type + Cmd/Ctrl+Enter run, Todo window, Stop);
  `page.mjs --url` runs against the deployed site after each Pages deploy.

### M4 — desktop (in progress)
- macOS native playground runs everything: `tools/build_native.sh` links the
  compiler crate and wasmi (ADR 0003: wasmi 3.3–4.6× faster than Pulley).
  `apps/playground/native/runner.rs` compiles on worker threads, runs console
  programs on wasmi with WASI (`pg_wasi.rs`, in-memory data tabs) in fuel
  slices (Stop), and hands GUI programs to `guest.rs`: their own GpuContext
  rendered offscreen and composited with `external_texture`, imports from the
  generated `guest_abi.rs` (gpu/clipboard → host; sys/storage/… sandboxed),
  fuel per event, input + IME caret forwarded from the Visual pane.
- Native host: async results + waker, `ureq` HTTP with cancel, `rfd` file
  dialogs, headless virtual clock, `CEANGAL_A11Y_DUMP` for tests.
- `tests/e2e/native.mjs`: 11 scenarios incl. the Todo window and all 29
  fixtures/examples byte-identical with the CLI; CI job `native-macos`.

## Blockers
- Pushing to `main` was refused by the session's permission check; local
  commits wait for the user to push. Pages also needs Settings → Pages →
  Source "GitHub Actions" once.

## Next
1. After the push: CI green (including `pages-e2e` on the live site), link the
   site from README.
2. M4 rest: AccessKit adapter (set `a11y::ACTIVE`), keychain-backed secrets,
   Windows and Linux CI builds + native E2E there, a native AI test against a
   mock server, a windowed smoke run on macOS.

## Known issues / workarounds
- almide/almide#3281 — `@export` outside the root module is dropped: apps carry
  the one-line `ceangal_event` forwarder.
- almide/almide#3283 — native leg emits the wrong struct for same-shape record
  literals: shared types (`lay.Size`, `snaidhm.Color`).
- almide/almide#3286 — dependency `let` constants wall on wasm: enums are variants.
- almide/almide#3287 — Bytes in a top-level `let` fails natively: functions.
- almide/almide#3294 — `bytes.append` is O(n²) on wasm: preallocate + `set_*`.
- almide/almide#3296 — functions reached only from closures are pruned on wasm.
  Usually a build error (`call:X`); in the playground the closure bodies were
  silently replaced with `exit(1)` stubs. Workaround: `let keep_x = f` at top
  level (editor.almd, ui.almd); `tests/wasm_stubs.mjs` guards the build. A
  minimal repro of the silent variant is still to be isolated.
- almide/almide#3297 — function values whose params are closures fail natively.
- almide/almide#3303 — match binding assigned to an outer var becomes `&T`
  natively: expression-form matches.
- almide/almide#3304 — generated `|c|` closure captures a user local `c`.
- almide/almide#3306 — native: `f(mut a, mut b, b[1])` fails to borrow-check:
  bind the argument with `let` first (deflate.almd).
- almide/almide#3337 — wasm: a `mut List` parameter, or two `mut Bytes`
  parameters, are copied on every call and the copies leak (maze / svg-art
  ran the playground out of memory). `snaidhm/src/vector.almd` keeps its
  buffers in ONE f32 `Bytes` passed as the only `mut` parameter.
- almide/almide#3307 — native: `other_module.var = x` inside a closure emits an
  unqualified name: setter fns in the owning module (state.almd).
- stdlib `zlib.deflate` is an effect fn, so share (a click handler) uses the
  pure `apps/playground/src/deflate.almd`.
- Native `get()` of an editor copies the whole buffer; avoid calling it per
  frame outside paint (role is passed in: `ed.view` / `ed.field`).
- `w_pct` inside a row is ignored by the layout engine; the playground sizes
  its output pane from the viewport instead.
- `clip()` is rectangular; no kerning; a11y tree is flat (parent 0).
- Native `secret_*` is a 0600 file, not yet the platform keychain (M4/M5).

## Human TODO
- [ ] Apple Developer Program membership (iOS + macOS App Store), team ID,
      distribution certificates, App Store Connect API key → GitHub secrets.
- [ ] Google Play developer account; start the 12-tester / 14-day closed test
      early (new personal accounts). Upload key → GitHub secrets.
- [ ] Microsoft Partner Center account; reserve the app name.
- [ ] Flathub: app ID decision (e.g. `dev.almide.Playground`) and submission PR.
- [ ] Install Xcode locally (only Command Line Tools present) if local iOS
      builds are wanted; CI uses GitHub macOS runners.
- [ ] Check the deployed web playground with a screen reader (VoiceOver) and
      on a phone (Safari iOS 26 / Chrome Android with WebGPU).
