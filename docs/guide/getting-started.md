# Getting started

## Install

macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/almide-graphics/ceangal2/main/install.sh | sh
```

Windows (PowerShell; the builds also need [Git for Windows](https://git-scm.com/download/win),
whose bash runs the build scripts):

```powershell
irm https://raw.githubusercontent.com/almide-graphics/ceangal2/main/install.ps1 | iex
```

Both put `ceangal` in `~/.ceangal/bin`. `CEANGAL_VERSION=0.2.0` installs a
given release instead of the latest.

You also need [Rust](https://rustup.rs) (every native build is a Rust
build) and [Node.js](https://nodejs.org) 20 or later (the web build's
checks). The Almide compiler comes by itself: each framework version pins
one and downloads it on first use.

`ceangal doctor` lists what each platform needs on this machine and how
to get what is missing:

```console
$ ceangal doctor
common
  ok       Almide 0.66.0 (tools/almide downloads it)
  ok       cargo (Rust)
  …
ios
  ok       Xcode
  missing  Rust target aarch64-apple-ios-sim
           → rustup target add aarch64-apple-ios-sim
```

## Make an app

```sh
ceangal new hello
cd hello
ceangal dev
```

`ceangal new` writes:

```
hello/
  ceangal.toml                 the app's identity and settings
  src/main.almd                the app: a counter
  .github/workflows/app.yml    CI: every platform built on each push
  README.md
  .gitignore
```

`ceangal dev` builds the web version, serves it at
<http://localhost:8000> and rebuilds when you save: the page reloads by
itself, and a build error shows on the page until you fix it.

`src/main.almd`:

```almide
import ceangal
import ceangal.view as v
import ceangal.widgets as w

var count = 0

fn bump() -> Unit = { count = count + 1 }

// Functions reached only from closures (almide/almide#3296).
let keep_bump = bump

fn view() -> v.View = {
  // light or dark, as the system is (and it follows when that changes)
  let th = w.system()
  ceangal.set_background(th.bg)
  v.col([
    w.title(th, "Hello"),
    v.text(int.to_string(count)) |> v.font(64.0) |> v.bold() |> v.color(th.text),
    w.button(th, "Count", () => bump()),
  ]) |> v.gap(20.0) |> v.align(v.Middle) |> v.justify(v.Center) |> v.fill()
}

// The web host calls into the app through this export.
@export(wasm, "ceangal_event")
fn ceangal_event(kind: Int, a: Int, b: Int, x: Float, y: Float, z: Float, w: Float) -> Int =
  ceangal.dispatch(kind, a, b, x, y, z, w)

effect fn main() -> Unit = ceangal.run(ceangal.app(view))
```

The view is a function of the app's state. A click handler changes the
state, and ceangal calls `view()` again and redraws. `w.button` is one of
the [standard controls](ui.md#controls), styled by a theme that follows
the system's light or dark mode. [Building UI](ui.md) covers views,
layout and input.

## Run it everywhere

```sh
ceangal dev macos       # the desktop app, restarted on each save (or linux, windows)
ceangal run ios         # the iOS simulator
ceangal run android     # a running emulator or a connected device
ceangal run web         # a release web build, served at localhost:8000
```

Builds go to `build/` in the app:

```sh
ceangal build web       # build/web: a static site (any web host)
ceangal build macos     # build/macos: the .app and the Mac App Store .pkg
ceangal build ios       # build/ios: the Xcode archive (and .ipa when signed)
ceangal build android   # build/android: the Play bundle (.aab) and an .apk
ceangal build windows   # build/msix: the Microsoft Store package
ceangal build linux     # build/flatpak: the Flathub bundle
```

The web build runs the app's wasm through `wasm-opt -Oz` (Binaryen,
downloaded once into the SDK's `.tools/`), which makes it about 28%
smaller; `ceangal dev` skips that step so reloads stay quick.

A desktop OS builds its own platform; iOS and macOS need a Mac. CI runs
every platform's build, so a Mac is enough day to day: push, and
`.github/workflows/app.yml` builds the other platforms and uploads each
package as an artifact.

## Next

- [Building UI](ui.md)
- [`ceangal.toml`](ceangal-toml.md): the app's name, icon, version, assets
  and permissions.
- [Stores and signing](stores.md): from a build to a store listing.
