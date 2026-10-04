# PROGRESS

Read at the start of every session; update at the end.

## Current milestone

**M1 — text and editor** (M0 done, pending CI on GitHub).

## Done

### M0 — ABI (2026-10-04)
- `docs/abi.md` host ABI v1; `tools/gen_bindings.py` generates every binding
  module and `abi/manifest.json`; `tests/abi_conformance.mjs` checks both hosts
  implement all 60 functions with matching signatures.
- snaidhm rewritten: one WGSL program, instanced quads (fill / stroke / shadow /
  glyph / image), clip stack, image batches (`snaidhm/src/mod.almd`,
  `shader.almd`).
- `snaidhm/native/gpu.rs`: wgpu 30, per-context handle tables (`GpuContext`),
  surface or offscreen target, readback, `external_texture` registry.
- ceangal runtime: closure-based views, v1 flex layout (74 Yoga tests pass),
  paint, hit testing, dispatch (`ceangal/src/mod.almd`, `view.almd`).
- Native host (`ceangal/native/host.rs`): winit window + headless mode with
  scripted input; sys / text_input / a11y / clipboard / storage / net / file
  modules.
- Web host (`hosts/web/host.js`): WebGPU, DOM events, hidden-textarea IME,
  ARIA overlay, localStorage, fetch streaming, file pick/save, headless mode.
- `tests/pixel/run.mjs`: demo renders **identically** (max diff 0) on headless
  Chrome WebGPU and native wgpu/Metal, three cases incl. click + 2x scale.

## Next
1. CI workflow (abi, layout, pixel on macOS; Linux with lavapipe).
2. M1: font engine — TTF/OTF parse (glyf + CFF?), cmap 4/12, kerning,
   rasterise to atlas, fallback chain (UI font, mono font, CJK font),
   measure/draw in `ceangal/src/text.almd`. Bundle fonts under `assets/fonts`.
3. M1: TextField, then the code editor widget.

## Known issues / workarounds
- almide/almide#3281 — `@export` outside the root module is dropped: apps carry
  the one-line `ceangal_event` forwarder.
- almide/almide#3283 — native leg emits the wrong struct for record literals
  when two types share a field set: `text.Extent` aliases `layout.Size`.
- almide/almide#3286 — dependency `let` constants wall on wasm: public enums
  are variants (`v.Middle`, `v.Center`…).
- Named fns stored as values walled wasm inside ceangal ("call:noop"), not yet
  reproduced in isolation; default handlers are lambdas.
- `w_pct` inside a stretched column is ignored by the layout engine (demo's
  70%/45% bars render full width) — investigate in M1.
- `clip()` is rectangular; rounded clipping not implemented.

## Human TODO
- [ ] Apple Developer Program membership (iOS + macOS App Store), team ID,
      distribution certificates, App Store Connect API key → GitHub secrets.
- [ ] Google Play developer account; start the 12-tester / 14-day closed test
      early (new personal accounts). Upload key → GitHub secrets.
- [ ] Microsoft Partner Center account; reserve the app name.
- [ ] Flathub: app ID decision (e.g. `dev.almide.Playground`) and submission PR.
- [ ] Install Xcode locally (only Command Line Tools present) if local iOS
      builds are wanted; CI uses GitHub macOS runners.
