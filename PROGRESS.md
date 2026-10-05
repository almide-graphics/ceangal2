# PROGRESS

Read at the start of every session; update at the end.

## 留守中の作業まとめ (2026-10-06 から, 最新が上)

- UAX #14 の行分割を実装 (ADR 0017, `ceangal.linebreak`)。Unicode の
  LineBreakTest.txt のうち対象範囲の 8014 行が全て一致 (CI)。エディタの
  ソフトラップが CJK の文字間・禁則・ハイフン後で折り返し、絵文字や結合
  文字の途中では切らない。web でフォールバックフォント読み込み前の幅で
  行数をキャッシュして次の行と重なる既存バグも修正。wasm +4.4 KB のため
  予算を 176 / 158 / 156 KB に (ADR 0017 に理由)。
- bidi を UAX #9 に沿って作り直し (ADR 0016): 埋め込み・上書き・
  isolate (LRE…PDF, LRI/RLI/FSI…PDI, LRM/RLM/ALM)、isolating run
  sequence、W1/W7・N1/N2・I1/I2・L1。python-bidi (unicode-bidi) を正解に
  ランダム 1000 行のテストを CI に追加 (3000 行で不一致 1 件、仕様上
  こちらが正しいと判断)。RTL 文字の左端のキャレットが文字に重なる
  問題も修正。Almide の native codegen が bidi 制御文字入りリテラルを
  通さないバグを almide/almide#3438 として報告。
- web ビルドに wasm-opt -Oz を導入 (ADR 0015)。Binaryen version_133 を
  tools/wasm-opt で固定・SHA-256 検証して自動取得。wasm が約 28% 縮小
  (gallery 230→167 KB)。予算を最適化後のサイズで測るよう変更し、
  170 / 152 / 150 KB に引き下げ。最適化後のバイトは Almide の検証外なので、
  web の E2E・Pages E2E・起動時間をすべて最適化版で実行して担保。
  `--all-features` は V8 が読めない import 形式を出すので機能を明示。
- RTL 文中の emoji ZWJ 列・国旗・点付きヘブライ文字が崩れないように修正
  (RTL 区間を論理順で整形し、クラスタ単位で右から並べる)。gallery の
  rtl.test に家族絵文字と שָׁלוֹם を入れ、スクショで確認。wasm は
  クロージャをループ化して予算内 (gallery 224.9 / 225 KB、余裕ほぼなし)。
- テキストフィールドの RTL 右寄せオプション `ed.with_align_end` を追加。
  描画とクリック位置の両方に同じずらしを入れ、gallery の Note 欄で
  「中央をタップすると論理末尾に入る」ことを web / native で検査
  (右寄せを切ると落ちることも確認)。hex 展開を共通化して予算内に収めた。
- Arabic を presentation forms から font の GSUB/GPOS へ移行 (ADR 0014)。
  HarfBuzz の Arabic shaper を移植し、38 語・句で glyph・位置まで完全一致
  (CI で検査)。lam-alef や合字の上の記号も正しく置かれる。bidi は並べ替え
  専用になり、行は `text.shape_line` で区間ごとに整形。wasm が約 10 KB
  増えたため、削れるだけ削ったうえで予算を gallery 225 / todo 204 /
  hello 202 KB に上げた (理由は ADR 0014。性能・サイズ項目で戻す)。
- Indic を 8 文字に拡大: Gurmukhi / Gujarati / Telugu / Kannada /
  Malayalam を追加。363 語で HarfBuzz と glyph・cluster・位置まで完全一致
  (CI で検査)。文字表を圧縮文字列にして wasm を約 5 KB 削減し、予算内に収めた。
- Android CI: エミュレータが「初期設定中」で HOME が無視される問題を、
  テスト側で本当に背面へ移るまで HOME を押すように修正 (31aa557)。
- (この下に作業ごとに追記していく)

## Current milestone

**M5 — mobile** (M0–M4 done locally; Android and iOS done locally, iOS CI
job added). M2's last
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
  - Passes 9/9 on an API 37 arm64 emulator (taps wait for the box to stop
    moving; slow CI emulators tapped mid-layout). CI job `android` (API 35 x86_64,
    KVM).
- iOS (ADR 0004, 0005): the same winit host. `tools/package_ios.sh <app>
  sim|e2e|archive|all` builds the Rust executable per SDK and an XcodeGen
  project around it (icon, assets, PrivacyInfo.xcprivacy); `archive` is the
  App Store build with local checks (and signing, export and App Store
  Connect validation once the secrets exist).
  - The keyboard's height (UIKit notification) joins the bottom inset; the
    soft keyboard opens on a tap on a text field only (all phones).
  - Keychain: generic passwords via security-framework.
  - `tests/e2e/ios/E2E.swift` (XCUITest; taps at the tree's boxes, typing on
    the on-screen keyboard): Todo app 2/2 (type, toggle, remove, background
    → foreground, safe area) and playground 3/3 (run on the device, Examples
    menu scrolls, the Todo example runs as a window and takes taps and
    typing). Local: iPhone 17 simulator, iOS 26.5, Xcode 26.6. CI job `ios`
    (macos-26).
- Key bar (記号入力バー, 2026-10-05): while the on-screen keyboard is up
  for the code editor, two rows above it — Tab, ← ↑ ↓ →, ( ) { } [ ] and
  " = |> => : . , _ + - < >. Taps keep the editor focused
  (`v.keeps_focus`); `ceangal.soft_keyboard()` is true while the keyboard
  adds to the bottom inset (Back / dismiss hides the bar with it).
- Every platform's E2E now edits the Todo example before running it (a tap
  at the top of the source, six lines down, a new task typed in front of
  the first; on phones its symbols come from the key bar) and checks the
  program shows the edit; and the fixtures + console examples run on the
  device on Android and iOS too, stdout compared with the CLI
  (`tests/lib/fixtures.mjs`; the runner reports runs through logcat /
  `CEANGAL_RUN_LOG` in test mode).
- Fixed on every platform along the way: a resized user-program window kept
  drawing its old texture (a freed texture handle's number was reused and
  snaidhm's bind group cache still pointed at the old texture).

### M6 — packaging (started; ADR 0005)
- iOS: see M5 (archive + local checks).
- Windows: `tools/package_msix.ps1` → MSIX with resources.pri, the app
  manifest (DPI awareness) embedded with mt.exe, scale-100/200 tiles, signed
  (secrets or a self-signed test cert), then WACK in CI.
- Linux: `tools/build_flatpak.sh` → Flatpak built offline from the exported
  Rust project; app ID `io.github.almide.playground` (Flathub verifies the
  domain; almide.dev does not resolve), runtime 26.08. Built in CI with
  `flathub-build` (Flathub's own wrapper: screenshot / icon mirroring) and
  passes `flatpak-builder-lint` manifest + repo.
- macOS: `tools/package_macos.sh` → universal (arm64 + x86_64) `.app` with
  App Sandbox (network client + user-selected files only), Info.plist, the
  .icns, signed (secrets identity or ad hoc) and an installer pkg; the
  sandboxed app runs (data lands in its container). CI job `macos-store`
  (validates with altool once the App Store Connect key is in secrets).

### AI panel and header (2026-10-05)
- Header: the files sit in it on wide screens; Examples ▾ next to them;
  quiet controls on the right (⋯ menu with Share link / Export project, ✦ AI,
  theme) and Run as the one filled button. Phones: Examples, ⋯ and theme on
  top, the files below, and AI / Code·Output / Run in the bottom bar.
- AI panel (beside the editor and output from 1180 px, in the output's place
  below that, a bottom sheet on phones): the conversation (request, written
  N lines, errors and fixes with expandable diffs, the run) and the prompt
  box; a follow-up changes the program on screen, + starts over. The key /
  provider / model card shows until a key is set (and stays until Done),
  then behind ⚙. Suggestions on an empty conversation. "✦ Fix with AI" is
  a pill in the status bar after a failed run (asks for a key if needed).
- Sessions, modes and files: a session is one conversation (New session
  starts over). Each request is "Edit project" or "New program" (a switch
  above the prompt; a fresh session on an untouched example starts as New,
  otherwise Edit), and a line under the prompt says what it sees and
  writes. Requests carry every file; replies are `=== name.almd ===` blocks
  streamed into their tabs (new files become tabs; a reply without markers
  goes to main.almd / the file on screen). Every request has Undo (the files
  as before it). Summaries per file: "stats.almd +1 −25, wrote fmt.almd".
- The code stays on screen until the first streamed text and comes back when
  a request fails or is stopped. The repair loop waits for its own run by
  id (stopping an earlier run reported "stopped" at once and was taken for
  the AI's result).
- Readable API errors (401/403 key refused, 429, unreachable).
- ceangal: `scroll_to_end(key)`, `a11y_hidden`, and a scroll view whose
  content fits no longer scrolls by its bottom padding.
- Not yet tried with a real provider key (tests use mock providers): Human
  TODO.

### Framework: `ceangal.toml` + the `ceangal` CLI (2026-10-05, ADR 0006)
- `cli/` (Almide; `tools/ceangal` builds it on first use): `new`, `build`
  (web native macos ios ios-sim android linux windows), `run` (web, desktop,
  ios simulator, android device/emulator with its log), `icons`, `env`,
  `info`. The framework comes from `[framework] path`, `$CEANGAL_SDK` or a
  clone at tag `v<version>` in `~/.ceangal/sdk`.
- Every script in `tools/` takes the app from APP_* variables
  (`tools/app_env.sh`; on their own they load `$CEANGAL_APP`, default the
  playground, so CI calls them as before). No script names an app; the
  playground's compiler crate, compiler build, runner extension and page
  are its `ceangal.toml` settings. `app.env` and `icon.env` are gone.
- Icons from one picture (`tools/app_icons.py`, existing files kept); web
  page / manifest / boot script, privacy manifest, Flatpak manifest /
  desktop entry / metainfo written from `ceangal.toml` when the app has
  none.
- Checked locally: playground web (file set identical to before) + web
  E2E, native + native E2E, macOS package, exported Rust project builds
  with cargo alone; Todo Mac app; Todo Android E2E; a `ceangal new` app
  outside the repository on the web (headless Chrome, clicked), macOS,
  the iOS simulator and the Android emulator.
- CI: `framework` job (a new app built for the web and the Mac); the
  reusable `.github/workflows/app.yml` for apps in their own repositories
  (written by `ceangal new`). Its Windows / Linux / Android / iOS jobs run
  for the first time when an app uses it.

### Framework: dev loop, releases, services, docs (2026-10-05, ADR 0007)
- `ceangal dev`: web (serves, rebuilds on save, open pages reload, a
  failed build's error covers the page until fixed) and desktop (rebuild +
  restart; a failed build keeps the running app). `tests/e2e/dev.mjs` (web
  in headless Chrome, and the Mac app) runs in the `framework` CI job.
- `ceangal --version`, `ceangal doctor [target…]` (tools/doctor.sh: each
  target's tools, with how to get the missing ones).
- `.github/workflows/release.yml` on tags: universal macOS, static Linux
  x86_64/aarch64 (musl), Windows binaries on the release; then
  `install.sh` / `install.ps1` from the release on three OSes, a new app,
  built for the web against the tagged framework.
- `ceangal.storage`, `ceangal.http`, `ceangal.asset(_text)`, `open_url`,
  `set_title`, `save_file`, `open_text_file`: string-level wrappers over
  the ABI. `tests/apps/services` checks them and an app's own Rust + JS
  extension (web in Chrome, native build) in CI.
- Docs: `docs/guide` (getting started, UI, ceangal.toml, CLI, stores and
  signing, native extensions); `docs/api` generated from the sources by
  `tools/gen_api_docs.py`, checked current in CI. `ceangal new` writes a
  README; doc comments added to the `ceangal` module.
- `app.yml` imports the Mac signing certificates like this repository's
  CI (it only passed the identity names before).
- Released v0.2.0 (2026-10-05): the release workflow built the four CLI
  binaries and installed them on macOS, Linux and Windows (each built a new
  app for the web against v0.2.0). ceangal-hello moved to v0.2.0: all six
  platform jobs green. The tag is lightweight (an annotated tag makes
  `git clone --branch` warn in every app's first build).

### Framework: standard controls, manifest checks (2026-10-05, ADR 0008)
- `ceangal.widgets`: buttons, checkbox, switch, radio group, segmented,
  slider, progress, text field, text styles, card, list row, dialog; Theme
  light / dark / system. Keyboard (Tab, Enter/Space, arrows), focus ring,
  hover / press, roles and states for screen readers.
- Runtime: `is_hovered`, `is_pressed`, `v.checked/selected/disabled`, roles
  15–20 on both hosts, AccessKit increment/decrement.
- Layout: wrap rows inside columns, percentage sizes of in-flow children,
  absolute left+right / top+bottom stretch (tests added).
- `apps/gallery` + `tests/e2e/gallery.mjs` (CI `framework` job). The
  `ceangal new` template uses the controls.
- `ceangal test`: tests/*.test (tap / type / key / see / not / wait /
  shot by accessible label) on the web build (headless Chrome) and the
  native build (headless); gallery, todo and the template have tests; CI
  runs them on macOS, Linux and Windows. docs/guide/testing.md.
- The guide's code examples are type-checked in CI
  (tools/check_doc_examples.py); every public function has a comment
  (gen_api_docs.py --check).
- Text beyond Latin (ADR 0009): Greek / Cyrillic, Arabic (joined via
  presentation forms), Hebrew, Thai, monochrome emoji; one-line bidi;
  fallback fonts lazy on the web (CJK too). Not yet: Indic shaping,
  colour emoji, RTL editing.

### Framework: text shaping and the rest of the quality list (2026-10-06)
- OpenType layout engine (`snaidhm/src/otl.almd`: GDEF, GSUB 1/2/4/5/6/7,
  GPOS 1/2/4/6/8/9) and an Indic shaper (`ceangal/src/indic.almd`) for
  Devanagari, Bengali and Tamil (ADR 0010). 203 words match HarfBuzz
  exactly (glyphs, clusters, offsets; `tests/shaping/indic.txt` from
  `tools/gen_shaping_cases.py`, checked in CI). Glyphs carry clusters;
  the editor uses `text.edges` / `glyphs_in`. Typing Hindi into a text
  field is a `ceangal test` (apps/gallery/tests/indic.test). Wasm budgets
  rise by 45 KB; the 10k-line editor frame got faster (p95 13.4 → 11.8 ms
  native).
- Colour emoji (ADR 0011): Twemoji Mozilla COLRv0 drawn layer by layer
  (`snaidhm/src/colr.almd`), UTS #51 sequences from generated emoji data,
  the font's ccmp through `otl`; caret stops / Backspace by cluster
  (`text.stops`, `backspace_to`; apps/gallery/tests/emoji.test).
- Indic, eight scripts (ADR 0010 update): Gurmukhi, Gujarati, Telugu,
  Kannada, Malayalam (fonts, script table: reph position / mode, blwf
  mode, matra positions; pref reordering, Malayalam base / dot reph,
  Kannada Ra+H+ZWJ); 363 HarfBuzz cases. indic_data / emoji_data packed
  as strings (−5 KB wasm).
- Dropdown / menu (ADR 0013): `v.overlay()` (painted last, hit first,
  ancestor clips dropped), one popup at a time in the runtime (a press
  outside closes it and its release does nothing), `w.dropdown`,
  `w.menu_button`, roles 21–25 + expanded flags on every host
  (apps/gallery/tests/popups.test).
- Android file picker: a framework Java activity (ceangal/android, javac +
  d8 into the app's dex) takes ACTION_OPEN_DOCUMENT's result and calls
  native code; the services E2E cancels with Back, then picks the file it
  saved.
- RTL editing (ADR 0012): `bidi.layout` (logical, per character),
  `text.LineGeo` (caret / spans / glyphs / nearest), wrapped rows reordered
  on their own, visual arrows (apps/gallery/tests/rtl.test).
- Arabic through the font's GSUB / GPOS (ADR 0014): `ceangal.arabic`
  (HarfBuzz's joining state machine, mark reordering, form / rlig / calt /
  liga stages, GPOS kern / mark / mkmk / curs), otl GPOS 5
  (mark-to-ligature, `Info.comp`), bidi reduced to levels / order,
  `text.shape_line` (segments by level and script, then display order),
  LineGeo sharing a cluster's width among its characters. 38 HarfBuzz
  cases (`tests/shaping/arabic.txt`, CI). Budgets +5 / +4 / +2 KB.
- `ed.with_align_end` (ADR 0012 update): right-to-left lines (and rows)
  end at the field's right edge; the shift is applied where lines are
  drawn and where x becomes a column. apps/gallery's Note field and
  rtl.test (a tap mid-field lands at the word's logical end). One shared
  `packed.hex` for the generated tables.
- Web builds through a pinned wasm-opt -Oz (ADR 0015): `tools/wasm-opt`
  (Binaryen version_133, SHA-256 checked), explicit feature list, stub
  check on Almide's own bytes first, skipped by `ceangal dev`. Budgets on
  the optimized module: 170 / 152 / 150 KB (were 225 / 204 / 202).
- Bidi per UAX #9 (ADR 0016): explicit embeddings / overrides /
  isolates, isolating run sequences, W1 W7 N1 N2 I1 I2 L1; 1000-line
  oracle from unicode-bidi (`tools/gen_bidi_cases.py`,
  `tests/bidi/cases.txt`); caret drawn left of an RTL character's left
  edge; isolate typed in apps/gallery/tests/rtl.test.
- Android E2E: adb commands wait for the device and retry when the
  emulator's connection drops for a moment.
- Line breaking by UAX #14 (ADR 0017): `ceangal.linebreak` (LB2–LB31
  except LB28a / LB30b; classes = block defaults + a 1.5 KB table from
  `tools/gen_linebreak.py`), 8014 LineBreakTest.txt lines in CI; the
  editor's soft wrap uses it (caret stops when no opportunity fits);
  wrap cache keyed on `text.font_generation()`.
- `ceangal dev` on Windows runs the app from a copy (the build could not
  replace the locked .exe).
- Phones: system clipboard, iOS share sheet / document picker, Android
  shared Downloads; TalkBack (AccessKit injecting adapter) and iOS
  VoiceOver trees checked in CI.
- `ceangal.toml` checks: unknown keys warn with a suggestion; types, ID /
  version / colour / build forms and paths are errors
  (`tests/cli/manifest_check.sh`).

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
- (none) Pages is enabled with the Actions source (2026-10-05, via the API).

## Next
0. Text: text views (labels) wrap with ceangal.linebreak (layout measure
   at a width). (Bidi W4–W6 / N0 if needed.) Then the goal's item 2
   (controls / accessibility).
   (Budgets now measure the wasm-opt build, ADR 0015: ~7 KB headroom.) Then controls / accessibility, size (win back
   ADR 0014's budget increase), M6, almide issues, docs and v0.3.0 notes.
   Framework: the quality list is done (see Done). Done: dropdown / menu, Android file picker, Indic shaping (ADR 0010), colour emoji (ADR 0011), RTL editing (ADR 0012), iOS VoiceOver / Android TalkBack trees,
   mobile clipboard / share / picker, text beyond Latin, release checksums
   + CHANGELOG, budgets, dev on Linux / Windows, v0.1.0, v0.2.0,
   ceangal-hello, `ceangal dev`, binary releases, doctor, services API,
   guide + API reference, manifest checks, standard controls, `ceangal
   test`, checked doc examples (ADR 0007, 0008).
1. First Pages deploy + `pages-e2e` against the live site (Pages enabled
   2026-10-05).
2. M6: store screenshots for iOS from the simulator build (the generator
   renders the web build today); the Play / App Store data-safety answers
   checked against the final feature set.
3. M4 rest: a native AI test against a mock server on Windows / Linux;
   AccessKit checked with screen readers (Human TODO).

## Known issues / workarounds
- CI Android (API 35 x86_64 emulator): adb sometimes drops for a moment
  ("device offline") during the playground's key-bar step and is back by
  the next step (7d8c181, bd47361). The same step runs fine on the local
  arm64 emulator once past the key bar (program up in 1.6 s).
  `tests/e2e/android.mjs` now waits for the device and retries the adb
  command (twice at most).
- almide/almide#3438 — bidi control characters in a string literal break
  native builds (rustc `text_direction_codepoint_in_literal`): build them
  with `string.from_codepoint`; tests use code point lists.
- almide/almide#3424 — a failing test in the ceangal package shows as a
  rustc error (`almide_rt_ceangal_v0_dispatch` not found): run
  `almide test --target wasm` to see the assertion.
- almide/almide#3417 — `println` output is held until exit in programs
  built by the standard codegen: `ceangal dev` prints through `dev_say`.
- almide/almide#3419 — a top-level fn with a `Bytes` parameter as a value
  does not compile natively: `on_result` handlers are passed as lambdas.
- almide/almide#3420 — wasm frees a `Bytes` before a value-returning
  extern call in tail position reads it: such calls are bound to a `let`
  first (`ceangal.save_file`, the playground's `http_begin` and
  `runner_gui_text`).
- almide/toml#2 — almide/toml does not build with Almide 0.66: the CLI
  parses `ceangal.toml` with the `toml` crate (native helper) and reads JSON.
- almide/almide#3379 — no process run with inherited stdio + exit code: the
  CLI's `sh_run` helper.
- almide/almide#3381 — git dependencies cannot name a package in a repo
  subdirectory: the CLI writes an uncommitted `almide.toml` with `path`
  dependencies to the resolved framework.
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
- Clipboard (system), save (iOS share sheet, Android shared Downloads),
  the iOS document picker and the Android system picker (through
  dev.ceangal.PickerActivity, 2026-10-06) work (tests/e2e/android_services.mjs,
  ServicesE2E).
- almide/almide#3433 — a lambda parameter annotated `List[mod.T]` breaks
  when another module declares `T`: Indic uses a top-level fn instead.
- Closure-only functions pinned with `let keep_x = x` (#3296) — but not one
  taking Bytes (#3419: colr.layers loops instead of mapping).
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
- [ ] Apple Developer Program membership (iOS + macOS App Store) as the
      organization AID-ON, K.K. (D-U-N-S 964469847). Enrollment submitted
      2026-10-05, enrollment ID 5N37NU7TFW: waiting for Apple to verify the
      signing authority (an email follows; then the agreement and payment).
      The D&B record still has the old head office (広島2-11-8 パレインヴィラ);
      the move to 橘通東4-1-4 河北ビル1F (registered 2026-09-15) is to be
      updated through Tokyo Shoko Research's contact form (free). The existing team
      "iwamoto takeshi" (XT522XX64M) is someone else's individual team: not
      used. After approval: App Store Connect API key (App Manager) and team
      ID → GitHub secrets ASC_KEY_ID / ASC_ISSUER_ID / ASC_KEY_P8 /
      IOS_TEAM_ID, Mac certificates for the pkg (Claude can do these steps
      once the membership is active).
- [ ] Google Play developer account as the organization AID-ON, K.K.
      (developer name "AID-ON"; organizations skip the 12-tester closed
      test). Tried 2026-10-05 from hiromi.motodera@aid-on.org and stopped
      before linking: the Google payments profile "Aid-On" (used by
      Workspace / Cloud) has 東京都台東区竜泉3-10-2 アミーレ浅草竜泉1003 and
      the D-U-N-S record the old 広島2-11-8 パレインヴィラ; linking the
      D-U-N-S changes that profile for every service. First the D&B address
      update (Tokyo Shoko Research, as for Apple; the payments profile
      address was moved to 橘通東4-1-4 河北ビル1F on 2026-10-05), then sign
      up again (US$25). After approval: upload key →
      GitHub secrets `ANDROID_KEYSTORE_B64` (base64 .jks),
      `ANDROID_KEYSTORE_PASS`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASS`
      (Claude can make the key and set them); enroll in Play App Signing.
- [ ] Android: try the APK on a real phone (soft keyboard with a Japanese
      IME, notch / gesture bar insets, Vulkan driver).
- [ ] Mac App Store: GitHub secrets MAC_CERTS_P12_B64 (Apple Distribution +
      Mac Installer certs), MAC_CERTS_PASS, MAC_APP_IDENTITY,
      MAC_INSTALLER_IDENTITY, MAC_PROVISIONING_PROFILE_B64, and ASC_KEY_ID /
      ASC_ISSUER_ID / ASC_KEY_P8 for `altool --validate-app`.
- [ ] Microsoft Partner Center company account: submitted 2026-10-05 from
      hiromi.motodera@aid-on.org with D-U-N-S 964469847 (publisher name
      "AID-ON", free). Email and business verified; employment verification
      under review (about 5 business days, result by email). The legal
      address it took from D&B is the old one (パレインヴィラ): update it once
      Tokyo Shoko Research has the new address. Store contact (public):
      info@aid-on.org, 4-1-4 Tachibanadori Higashi Kahoku Bldg 1F, and
      +81 80-7974-1025 for now — replace the phone with a 050 number before
      the first app submission. After approval: reserve "Almide Playground";
      its Publisher value (`CN=…`) → GitHub secret `MSIX_PUBLISHER` (Claude
      can set it).
- [ ] Flathub: confirm the app ID `io.github.almide.playground` (or register
      almide.dev and move to `dev.almide.playground`), then the submission PR.
- [ ] iOS App Store: GitHub secret IOS_TEAM_ID (with the ASC_* key above the
      `ios` job signs, exports and validates); create the app record
      `dev.almide.playground` in App Store Connect; try the app on a real
      iPhone (Xcode → Settings → Accounts, then Run on the device).
- [ ] Native: check the API key lands in Keychain / Credential Manager /
      Secret Service (the app asks the OS store; tests use a file instead).
- [ ] Native: VoiceOver (macOS, iOS), TalkBack (Android), Narrator
      (Windows), Orca (Linux) read the playground through AccessKit, with
      the real screen reader on (CI checks the tree each one gets, not the
      speech).
- [ ] Try the AI panel with a real key for each provider (Claude, OpenAI,
      Gemini): generate, a follow-up, Fix with AI, a wrong key's message.
- [ ] Check the deployed web playground with a screen reader (VoiceOver) and
      on a phone (Safari iOS 26 / Chrome Android with WebGPU).
