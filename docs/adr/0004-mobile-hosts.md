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
- **iOS.** A winit app built from the same sources, as a plain executable
  (ADR 0005 has the packaging). The surface uses `outer_size`, the safe area
  comes from `inner_position` / `inner_size`, and data lives under
  `$HOME/Library/Application Support`. UIKit reports the on-screen keyboard
  only through notifications: `ceangal_platform` observes
  `UIKeyboardWillChangeFrameNotification` (objc2 + block2) and the host adds
  the keyboard's height to the bottom inset. On both phones the keyboard can
  close without telling the app (Android's Back goes to the IME; iOS's
  dismiss key), so while it may be up the host re-reads the insets every
  250 ms, and every 30 ms for a second after they change. Secrets are generic
  passwords in the app's keychain (security-framework).
- **The soft keyboard opens on a tap.** On phones and tablets ceangal asks for
  the on-screen keyboard only after a finger tapped a text field, not when
  the app focuses one by itself (the playground focuses its editor at start,
  and a keyboard covering half the screen on launch is wrong). A tap
  elsewhere moves the focus and so closes it.
- **GPU.** On first resume the host creates the wgpu instance with the
  window's display handle, which GL/EGL needs. On Android it tries Vulkan
  first and GL second, one backend per instance: a Vulkan surface and an EGL
  surface cannot share one `ANativeWindow` (`eglCreateWindowSurface` →
  `BadAlloc`). Mobile drops the surface in `suspended` and makes a new one in
  `resumed`.
  - Minimum GPU: Vulkan, or GLES 3.1 with vertex-stage storage buffers,
    because the snaidhm shader pulls instances from a storage buffer.
    Android 10+ 64-bit devices must have Vulkan 1.1, so this excludes almost
    no real phones.
  - The Android emulator's `-gpu host` mode on macOS is GLES 3.0-class and
    gets an error message instead of a picture. Use
    `-gpu swiftshader_indirect` (what the E2E runs) or a device.
- **Thread locals on Android.** Rust's Android std implements `thread_local!`
  with one pthread key per static. Bionic has ~128 keys, and generated Almide
  code has hundreds of thread locals (almide/almide#3347). The Android build
  therefore rebuilds std (`-Zbuild-std`) with `-Zhas-thread-local=yes`
  (emulated TLS, one key in all) under `RUSTC_BOOTSTRAP=1`, and links
  clang's builtins for `__emutls_get_address`. This uses unstable flags on a
  pinned stable toolchain. It goes away once almide groups its globals.

## Consequences
- **TalkBack through AccessKit's injecting adapter.** accesskit_winit's
  Android adapter needs GameActivity (a Java build), but the
  `InjectingAdapter` underneath takes any View: `ceangal_platform` puts it
  on NativeActivity's content view, with the Java delegate from its
  embedded dex (2026-10-05, ADR 0008). iOS uses accesskit_winit's UIKit
  adapter. Both are checked in CI through the platform's own accessibility
  APIs (uiautomator on Android, XCUITest on iOS).
- Phones use the system clipboard; save goes to the share sheet (iOS) or
  the shared Downloads folder (Android). Open is the document picker on
  iOS. A NativeActivity cannot receive an activity result, so on Android a
  small Java activity of the framework's (`ceangal/android/dev/ceangal/
  PickerActivity.java`, compiled into the app's dex by build_android.sh
  with javac and d8) opens ACTION_OPEN_DOCUMENT, reads the file and hands
  it to the native code through a method ceangal_platform registers
  (2026-10-06). The app now has code (`hasCode="true"`): that one class.
- Tests drive the real app on an emulator through `adb shell input`. Taps go
  to the a11y tree's rects × scale, and the user program's tree is logged
  with `debug.ceangal.gui_a11y`.
