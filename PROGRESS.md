# PROGRESS

Read at the start of every session; update at the end.

## Current milestone

**M2 — the playground on the web** (M0 and M1 done). Every feature of the
old playground is in, AI and export included, and passes locally. Left for
M2: the first green CI run on main, which deploys Pages (blocked: pushing to
main needs the user — see Blockers).

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

## Blockers
- Pushing to `main` was refused by the session's permission check; local
  commits wait for the user to push. Pages also needs Settings → Pages →
  Source "GitHub Actions" once.

## Next
1. After the push: CI green, check the deployed URL in a real browser, link
   it from README.
2. M3: user GUI on the web — bundled ceangal/snaidhm packages for user code,
   Worker + OffscreenCanvas host, the Todo demo editable and runnable in the
   playground, E2E.
3. M4: desktop native runner (compiler crate linked, wasm runtime: Pulley vs
   wasmi ADR), AccessKit adapter (set `a11y::ACTIVE`), file dialogs.

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
- almide/almide#3307 — native: `other_module.var = x` inside a closure emits an
  unqualified name: setter fns in the owning module (state.almd).
- stdlib `zlib.deflate` is an effect fn, so share (a click handler) uses the
  pure `apps/playground/src/deflate.almd`.
- Native `get()` of an editor copies the whole buffer; avoid calling it per
  frame outside paint (role is passed in: `ed.view` / `ed.field`).
- `w_pct` inside a row is ignored by the layout engine; the playground sizes
  its output pane from the viewport instead.
- `clip()` is rectangular; no kerning; a11y tree is flat (parent 0).
- Native runner is a stub (status "native runner pending (M4)").
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
