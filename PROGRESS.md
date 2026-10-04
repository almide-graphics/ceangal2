# PROGRESS

Read at the start of every session; update at the end.

## Current milestone

**M5 — mobile** (M0–M4 done locally; Android done, iOS next). M2's last
item, the first green CI run on main that deploys Pages, waits for a push
(see Blockers).

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
  fixtures/examples byte-identical with the CLI. Passes on macOS and on Linux
  (aarch64 Docker, lavapipe: `tools/docker/linux.Dockerfile`); CI jobs
  `native-macos`, `native-linux`, `native-windows` (Windows not yet run:
  relies on wgpu's DX12 WARP adapter for headless rendering).
- AccessKit adapter in the windowed host (tree pushed after each frame,
  click/focus actions → event 12); secrets in the platform keychain
  (`keyring`; headless runs use a 0600 file); app id baked in at build.

### M5 — mobile (in progress)
- Android (ADR 0004): apps are NativeActivity cdylibs (`android_main` runs the
  program's `main`). Without Gradle, `tools/build_android.sh <app>` builds a
  signed AAB (Play upload) and a universal APK for arm64-v8a and x86_64,
  targetSdk 37, min 26. Libraries are 16 KB aligned (`zipalign -c -P 16`),
  and `apksigner verify` and `bundletool validate` both pass.
- The host's per-target crates live in `ceangal/native/ceangal_platform`
  (desktop arboard / rfd / keyring; mobile fallbacks; Android JNI helpers).
- Mobile host: touch → pointer ids ≥ 1, the surface is dropped on suspend
  and recreated on resume, and safe-area insets (Android `WindowInsets`
  incl. the IME; iOS safe area) arrive as event 11. ceangal lays the app out
  inside them. Also: the soft keyboard follows the text focus, Back maps to
  Escape, the deep link comes from the intent data, assets from the
  AssetManager, and stdout / stderr / `log` go to logcat.
- GPU: on Android the host tries Vulkan, then GL, one backend per instance,
  with the display handle (EGL `BadAlloc` otherwise).
- `tests/e2e/android.mjs` (emulator, `adb input`, a11y tree via logcat with
  `debug.ceangal.a11y` / `gui_a11y`):
  - Todo app: type with the soft keyboard + Enter, toggle, remove,
    background → foreground, safe area.
  - Playground: compiles and runs on the device, and the Todo program runs
    as a window that takes taps and Stops.
  - Passes 8/8 on an API 37 arm64 emulator. CI job `android` (API 35 x86_64,
    KVM).
- iOS: not started (needs Xcode locally; see Human TODO).

### M6 — packaging (started)
- macOS: `tools/package_macos.sh` → universal (arm64 + x86_64) `.app` with
  App Sandbox (network client + user-selected files only), Info.plist, the
  .icns, signed (secrets identity or ad hoc) and an installer pkg; the
  sandboxed app runs (data lands in its container). CI job `macos-store`
  (validates with altool once the App Store Connect key is in secrets).

### Brand and feel (follows almide/playground at its v2 brand, 2026-10-02)
- `tools/build_brand.py` makes every store and app icon from the v2 SVGs in
  `store/brand/` (armadillo mark, rendered by Chrome): iOS / Play 1024,
  Play feature graphic, Android adaptive layers, macOS .icns, MSIX tiles,
  Linux hicolor, web favicon / PWA icons, the header mark.
- Palettes: dark = almide/playground's CSS variables, light = almide/docs'
  light theme. The app follows the system (event 11; Android reads the
  configuration's night mode), the header toggle overrides it and is saved,
  and `?theme=light|dark` forces it.
- Phone layout as almide/playground: a bottom bar (AI, Output/Code, Share,
  Run), Run flips to the output and loading an example flips back to the
  code, AI is a bottom sheet, code is 15 px and soft-wraps.
- Runs start on Output and go to Visual only when they exit 0 with a picture.
- Editor: touch drag scrolls with momentum, a tap places the caret (and only
  a tap raises the soft keyboard), press-and-hold then drag selects. Wheel
  scrolling locks to the dominant axis and stops at the content's edges.
  Soft wrap breaks at spaces, with row-based hit testing, caret movement
  and line numbers.
- Web passes the safe-area insets (env()) to the app.
- The header follows the theme too (dark ground + the light-tailed mark in
  dark mode, white + the colour mark in light mode).
- ceangal scroll views (`v.scroll_y(key)`): wheel, finger drag with momentum
  (cancels the press under the finger), clipped and hit-tested correctly;
  the Examples menu uses one (70% of the screen at most).

## Blockers
- Pushing to `main` was refused by the session's permission check; local
  commits wait for the user to push. Pages also needs Settings → Pages →
  Source "GitHub Actions" once.

## Next
1. After the push: CI green (including `pages-e2e` on the live site), link the
   site from README.
2. M4 rest: see the Windows CI result; a native AI test against a mock
   server; AccessKit checked with VoiceOver / Narrator / Orca (Human TODO).

## Known issues / workarounds
- almide/almide#3349 — `build --cdylib -o <path>` uses the path as the crate
  name: build with `-o <name>` and move `lib<name>.so`.
- almide/almide#3350 — `[native-deps]` cannot be target-specific: the
  `ceangal_platform` facade crate (ADR 0004).
- almide/almide#3359 — the Windows release zip has no top-level folder:
  tools/almide unzips into the asset-named folder.
- almide/almide#3358 — `[]` in a record spread update fails E018: a typed
  helper (`no_rows()` in editor.almd).
- almide/almide#3346 — cdylib builds omit `flate2` for zlib users: the
  playground declares it in `[native-deps]` (tools/build_native.sh).
- almide/almide#3347 — one `thread_local!` per top-level var exhausts
  Android's pthread keys ("out of TLS keys"): the Android build rebuilds std
  with emulated TLS (`-Zbuild-std`, `-Zhas-thread-local=yes`,
  `RUSTC_BOOTSTRAP=1`, clang builtins linked).
- Android has no TalkBack (accesskit's adapter needs GameActivity). The
  clipboard is in-app only on mobile, and export saves into the app's
  `Downloads` folder (no share sheet / picker yet).
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

## Human TODO
- [ ] Apple Developer Program membership (iOS + macOS App Store), team ID,
      distribution certificates, App Store Connect API key → GitHub secrets.
- [ ] Google Play developer account; start the 12-tester / 14-day closed test
      early (new personal accounts). Upload key → GitHub secrets
      `ANDROID_KEYSTORE_B64` (base64 .jks), `ANDROID_KEYSTORE_PASS`,
      `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASS`; enroll in Play App Signing.
- [ ] Android: try the APK on a real phone (soft keyboard with a Japanese
      IME, notch / gesture bar insets, Vulkan driver).
- [ ] Mac App Store: GitHub secrets MAC_CERTS_P12_B64 (Apple Distribution +
      Mac Installer certs), MAC_CERTS_PASS, MAC_APP_IDENTITY,
      MAC_INSTALLER_IDENTITY, MAC_PROVISIONING_PROFILE_B64, and ASC_KEY_ID /
      ASC_ISSUER_ID / ASC_KEY_P8 for `altool --validate-app`.
- [ ] GitHub Pages: Settings → Pages → Source "GitHub Actions".
- [ ] Microsoft Partner Center account; reserve the app name.
- [ ] Flathub: app ID decision (e.g. `dev.almide.Playground`) and submission PR.
- [ ] Install Xcode locally from the App Store and open it once (license,
      components); then iOS builds and the simulator run here too.
- [ ] Native: check the API key lands in Keychain / Credential Manager /
      Secret Service (the app asks the OS store; tests use a file instead).
- [ ] Native: VoiceOver (macOS), Narrator (Windows), Orca (Linux) read the
      playground through AccessKit.
- [ ] Check the deployed web playground with a screen reader (VoiceOver) and
      on a phone (Safari iOS 26 / Chrome Android with WebGPU).
