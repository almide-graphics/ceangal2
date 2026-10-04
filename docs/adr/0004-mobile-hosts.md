# ADR 0004 — Mobile hosts: NativeActivity cdylib on Android, winit on iOS

Date: 2026-10-04 · Status: accepted

## Context
The same Almide app must run on Android and iOS with the native ceangal host
(winit + wgpu). It must also be packaged in CI without the platforms' IDEs.
The desktop host's crates are not all portable: arboard does not build for
Android, rfd has no mobile backend, and keyring's Apple store needs a
different feature set on iOS. almide's `[native-deps]` cannot be
target-specific.

## Decision
- **Platform crate.** `ceangal/native/ceangal_platform/` is a small Cargo
  crate. almide copies native subdirectories into the generated crate's
  `src/`, so `ceangal/almide.toml` depends on it as
  `{ path = "src/ceangal_platform" }`. It holds the target-specific crates
  and gives the host one API for clipboard, file dialogs, keychain and
  Android JNI helpers. Desktop gets arboard / rfd / keyring. Mobile gets an
  in-app clipboard, saves into `<data>/Downloads`, and keeps secrets in
  files in the app sandbox, which is private already.
- **Android.** The app is a cdylib loaded by `android.app.NativeActivity`, so
  there is no Java/Kotlin code and no dex.
  - `android_main` runs the program's `main` (almide renames it
    `__almide_unused_main` in a cdylib). winit is built with
    `android-native-activity`.
  - Assets come from the APK's AssetManager; data lives in
    `internal_data_path`. stdout/stderr and `log` records are piped to
    logcat.
  - Safe area: the app targets API 35+, which is always edge to edge, so the
    host reads `WindowInsets` (system bars, cutout, IME) through JNI on every
    frame and sends them as event 11. ceangal lays the app out inside them.
  - The deep link is the intent's data URI.
  - Packaging is `tools/build_android.sh`: aapt2 (proto format) → base module
    → bundletool AAB, then a universal APK for emulators. Libraries are
    linked with `max-page-size=16384` and stored uncompressed with 16 KB
    alignment (checked with `zipalign -c -P 16`).
- **iOS.** A winit app built from the same sources. The surface uses
  `outer_size`, the safe area comes from `inner_position` / `inner_size`, and
  data lives under `$HOME/Library/Application Support`.
- **GPU.** On first resume the host creates the wgpu instance with the
  window's display handle, which GL/EGL needs. On Android it tries Vulkan
  first and GL second, one backend per instance: a Vulkan surface and an EGL
  surface cannot share one `ANativeWindow` (`eglCreateWindowSurface` →
  `BadAlloc`). Mobile drops the surface in `suspended` and makes a new one in
  `resumed`.
- **Thread locals on Android.** Rust's Android std implements `thread_local!`
  with one pthread key per static. Bionic has ~128 keys, and generated Almide
  code has hundreds of thread locals (almide/almide#3347). The Android build
  therefore rebuilds std (`-Zbuild-std`) with `-Zhas-thread-local=yes`
  (emulated TLS, one key in all) under `RUSTC_BOOTSTRAP=1`, and links
  clang's builtins for `__emutls_get_address`. This uses unstable flags on a
  pinned stable toolchain. It goes away once almide groups its globals.

## Consequences
- **No TalkBack yet.** accesskit_winit's Android adapter needs GameActivity,
  and adopting it would bring back a Java build. The tree still exists, and
  the Android E2E reads it from logcat (`debug.ceangal.a11y`).
- Mobile clipboard is in-app only, export goes to the app's folder (no
  share sheet), and there is no file picker. These are listed as known
  issues.
- Tests drive the real app on an emulator through `adb shell input`. Taps go
  to the a11y tree's rects × scale, and the user program's tree is logged
  with `debug.ceangal.gui_a11y`.
