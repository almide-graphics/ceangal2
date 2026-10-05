# The `ceangal` CLI

Every command works on the app in the current directory, or the one
`--app DIR` names.

```
ceangal new <dir> [--id ID] [--name NAME]
ceangal dev [web|macos|linux|windows] [--port N]
ceangal build <target>
ceangal run <target>
ceangal test [web|native|all] [file.test…]
ceangal doctor [target…]
ceangal icons
ceangal info
ceangal env
ceangal --version
```

## `new`

Creates an app: `ceangal.toml`, `src/main.almd` (a counter),
`.github/workflows/app.yml`, a README and a `.gitignore`. The ID defaults
to `dev.example.<dir>` and the name to the directory's name in title case.
The app pins the framework version of the CLI that made it. With
`$CEANGAL_SDK` set, it uses that checkout by path instead.

## `dev`

Builds the app, then keeps watching it: its sources (the entry's
directory), `ceangal.toml`, and the asset, native and web paths
`ceangal.toml` names.

- `ceangal dev` (or `dev web`) serves the web build at
  `http://localhost:8000` (`--port` changes it). After each change it
  rebuilds and every open page reloads. When a build fails, the pages show
  the compiler's error over the app until the next build succeeds. The
  page you are looking at only changes once a build has finished: builds
  go to a separate directory and replace the served one in one step.
- `ceangal dev macos` (or `linux`, `windows`, `native`) builds the desktop
  app and starts it. After each change it rebuilds, and if the build
  succeeds it closes the app and starts the new build. A failed build
  leaves the running app alone. Closing the app ends `ceangal dev`; if the
  app crashes, `ceangal dev` says so and starts it again after the next
  edit.

The app's state does not survive a rebuild. What it keeps in
`ceangal.storage` does.

## `build <target>`

| target | output (under `build/`) | builds on |
|---|---|---|
| `web` | `web/`: a static site; `index.html`, the wasm, assets | any |
| `native` | `native/<key>`: the executable for this machine | any |
| `macos` | `macos/<Name>.app` (universal) and `macos/<key>.pkg` for the Mac App Store | macOS |
| `ios` | `ios/<key>/`: the Xcode project and archive (an `.ipa` when signed) | macOS |
| `ios-sim` | `ios/<key>/build/sim/<key>.app` for the simulator | macOS |
| `android` | `android/<key>.aab` for Play and `android/<key>.apk` | any |
| `windows` | `msix/<key>.msix` for the Microsoft Store | Windows |
| `linux` | `flatpak/<linux id>.flatpak` | Linux |

Store icons the app's store directory lacks are made first (see `icons`).
Signing comes from environment variables ([Stores and signing](stores.md)):
without them, packages are built unsigned (macOS, iOS, Windows) or with a
debug key (Android), which is enough for testing.

## `run <target>`

| target | |
|---|---|
| `web` | a release web build, served at `http://localhost:8000` |
| `macos`, `linux`, `windows`, `native` | builds and starts the desktop app |
| `ios` | builds for the simulator, boots one (`IOS_SIM` = a device UDID or the first iPhone), installs and launches it |
| `android` | builds for the connected device's or emulator's ABI, installs, launches, and follows its log |

## `test [web|native|all] [file.test…]`

Builds the app and runs its tests (`tests/*.test`, or the files named) on
the web build in headless Chrome and on the native build headless. See
[Testing](testing.md).

## `doctor [target…]`

Checks the tools each target needs (Rust targets, Xcode, the Android SDK
and NDK, Java, the Windows SDK, flatpak-builder…) and prints how to get
the missing ones. Without targets it checks every target this OS can
build and always exits 0. With targets it exits 1 when something is
missing, which is useful in scripts.

## `icons`

Writes every icon size each platform and store needs into the app's
store directory, from `[app] icon` (or the name's initial). Files already
there are kept, so a hand-made icon for one platform wins.

## `info`, `env`

`info` prints the app as the CLI reads it: identity, paths and the
framework it resolved. `env` prints the same as shell variables, which is
what the build scripts receive:

| variable | |
|---|---|
| `CEANGAL_SDK` | the framework's directory |
| `APP_DIR`, `APP_KEY`, `APP_ID`, `APP_NAME`, `APP_VERSION`, `APP_BUILD` | the app |
| `APP_ENTRY`, `APP_ICON`, `APP_ICON_BG`, `APP_ASSETS` (one per line) | |
| `APP_NETWORK`, `APP_CATEGORY`, `APP_COPYRIGHT`, `APP_DESCRIPTION`, `APP_PUBLISHER`, `APP_LANGUAGES` | |
| `APP_NATIVE_DIR`, `APP_NATIVE_DEPS` | `[native]` |
| `APP_WEB_BOOT`, `APP_WEB_FILES`, `APP_WEB_PREBUILD`, `APP_WEB_OUT` | `[web]` |
| `APP_LINUX_ID`, `APP_STORE`, `APP_OUT` | |

The scripts in the framework's `tools/` can be run directly once these
are set: `eval "$(ceangal env)"; "$CEANGAL_SDK/tools/package_ios.sh"`.

## Environment

| variable | |
|---|---|
| `CEANGAL_SDK` | build with this framework checkout, whatever `ceangal.toml` says |
| `CEANGAL_BASH` | Windows: the bash to run the build scripts with (default: Git's) |
| `MAC_ARCHS` | `ceangal build macos`: `arm64`, `x86_64` or both (default) |
| `IOS_SIM` | `ceangal run ios`: the simulator's UDID |
| `ANDROID_HOME` | the Android SDK (default: Android Studio's location) |
| signing | see [Stores and signing](stores.md) |

## CI

`ceangal new` writes `.github/workflows/app.yml`:

```yaml
jobs:
  app:
    uses: almide-graphics/ceangal2/.github/workflows/app.yml@v0.2.0
    secrets: inherit
```

Each push builds every platform with the framework version
`ceangal.toml` names. The web build is opened in headless Chrome and the
Mac app is started once, and each store package is uploaded as an
artifact. Inputs:

| input | default | |
|---|---|---|
| `platforms` | `web macos ios android windows linux` | which jobs run |
| `click` | none | an accessible label the web check clicks (e.g. a button's) |
| `app` | `.` | the app's directory, when it is not the repository's root |
| `framework` | none | a ceangal2 branch or tag to build with instead |

With the repository's secrets set ([Stores and signing](stores.md)), the
packages come out signed.
