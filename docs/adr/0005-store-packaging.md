# ADR 0005 — Store packaging: thin wrappers around the one Rust build

## Context
Each store wants its own container: an Xcode archive for the App Store, an
installer pkg for the Mac App Store, an AAB for Play, an MSIX for the
Microsoft Store and a Flatpak for Flathub. Every one of them is built in CI
and checked with the store's own validator where one runs without an
account. The app itself is always the executable (or Android cdylib) that
`almide build` produces from the same sources; the packaging must not fork
it.

## Decision
- **One build per target, wrapped by a script.** `tools/package_macos.sh`,
  `tools/package_ios.sh`, `tools/build_android.sh`, `tools/package_msix.ps1`
  and `tools/build_flatpak.sh` each take the Rust build for their target and
  add only what the store needs (bundle, manifest, icons, privacy manifest,
  signature). Store identity comes from `apps/<app>/app.env`.
- **iOS: an Xcode project without sources.** `tools/package_ios.sh`
  generates the project with XcodeGen (pinned release, downloaded when not
  installed). The app target has no compile sources: a build phase copies
  the prebuilt executable for the SDK being built (`aarch64-apple-ios` or
  `aarch64-apple-ios-sim`) to `EXECUTABLE_PATH`, and Xcode compiles the
  asset catalog (single 1024 icon), copies `assets/` and
  `PrivacyInfo.xcprivacy`, signs, archives and exports. No Objective-C or
  Swift shim is needed because winit's iOS backend starts UIKit from the
  Rust `main`.
  - Archive checks done locally because App Store Connect's own validation
    needs an account: platform iOS with minimum 16.0, arm64 only, required
    Info.plist keys, compiled icon, privacy manifest, only SDK frameworks
    linked. With `IOS_TEAM_ID` and an App Store Connect API key in secrets,
    the same script signs, exports the .ipa and runs `altool --validate-app`.
- **iOS E2E: XCUITest with coordinates.** UIKit cannot see ceangal's widgets
  (there is no AccessKit iOS adapter yet), so the UI test
  (`tests/e2e/ios/E2E.swift`) reads the tree the app writes to a file
  (`CEANGAL_A11Y_LOG`, the text the Android E2E reads from logcat) and taps
  the boxes' centres. Typing goes key by key on the system keyboard, so the
  path is the real on-screen keyboard and IME. The tests run on a simulator
  of their own (`ceangal-e2e <model>`, English, QWERTY) so the user's
  simulators keep their settings.
- **Flathub app ID `io.github.almide.playground`.** Flathub verifies the
  app ID's domain, and almide.dev does not resolve, so the Linux build uses
  the GitHub form (verified through github.com/almide). The other stores
  keep `dev.almide.playground`, which they do not verify. If the Almide
  project gets the almide.dev domain, Flathub can move to it with an
  `<replaces>` / end-of-life rename.
- **Windows: the manifest WACK wants.** The MSIX's exe gets an application
  manifest (per-monitor-v2 DPI awareness, Windows 10/11, UTF-8, asInvoker)
  embedded with `mt.exe`, and every tile image has a scale-100 variant, the
  default `resources.pri` resolves to.

## Consequences
- The iOS project is generated, never committed; changing the bundle means
  editing `tools/package_ios.sh`.
- iOS VoiceOver does not see the app until AccessKit gains a UIKit adapter
  (listed with the other screen-reader checks in Human TODO).
- The Flathub ID differs from the other platforms' bundle IDs. The data
  directory and keychain service follow `CEANGAL_APP_ID`, so Linux data
  lives under `io.github.almide.playground`.
