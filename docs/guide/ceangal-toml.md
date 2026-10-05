# `ceangal.toml`

An app is a directory with a `ceangal.toml` and Almide sources. Paths in
the file are relative to the app's directory. Only `[app] id` is required.

```toml
[app]
id = "dev.example.todo"
name = "Todo"
version = "1.2.0"
build = 7
icon = "icon.png"
icon_background = "#2E7D32"
description = "A small to-do list"
publisher = "Example Ltd"
network = true
assets = ["assets"]

[framework]
version = "0.2.0"
```

## `[app]`

| key | default | |
|---|---|---|
| `id` | required | Reverse-DNS identifier: the bundle ID (Apple), application ID (Android), package name (Windows). Fixed once the app is in a store. |
| `key` | last segment of `id`, lower case, letters and digits only | File names: the executable, `<key>.wasm`, `<key>.aab`, … |
| `name` | `id` | The name people see under the icon and in the window title. |
| `version` | `"0.1.0"` | The version people see (CFBundleShortVersionString, versionName). |
| `build` | `1` | The store build number (CFBundleVersion, versionCode). Every upload to a store needs a higher one. |
| `entry` | `"src/main.almd"` | The program. |
| `icon` | none | A 1024 × 1024 PNG, edge to edge (each platform applies its own mask). Without one, the icons show the name's initial. |
| `icon_background` | `"#FFFFFF"` | The Android adaptive icon's background, the Windows tiles', the web app's theme colour. |
| `description` | `""` | One line for the stores, Linux launchers and the web page. |
| `publisher` | `name` | The publisher shown by Windows and Linux. |
| `copyright` | `""` | macOS's NSHumanReadableCopyright. |
| `category` | `"public.app-category.utilities"` | The macOS App Store category ([values](https://developer.apple.com/documentation/bundleresources/information-property-list/lsapplicationcategorytype)). |
| `languages` | `["en"]` | The languages the Windows package declares (`en-us`, `ja-jp`, …). |
| `network` | `false` | The app talks to the network: Android's INTERNET permission, the macOS sandbox's network client entitlement. `ceangal.http` needs it. |
| `assets` | `[]` | Directories bundled with the app, read with `ceangal.asset(path)` / `ceangal.asset_text(path)`. Merged over the framework's own (its fonts, under `fonts/`); a file of yours replaces the framework's file of the same name. |

## `[framework]`

Which ceangal the app is built with: one of

| key | |
|---|---|
| `version = "0.2.0"` | The release tagged `v0.2.0`. The CLI fetches it into `~/.ceangal/sdk/0.2.0` the first time. |
| `path = "../ceangal2"` | A checkout: for working on the framework and an app together. |

`$CEANGAL_SDK` (a checkout's path) overrides both.

## `[native]`

Your own Rust for the native builds: see [Native extensions](native.md).

| key | |
|---|---|
| `dir` | A directory of `.rs` files. Each `name.rs` becomes the module `crate::name`, which `@extern(rust, "crate::name", "fn")` names. |
| `deps` | Cargo dependencies, as in `Cargo.toml`: `{ serde_json = "1", image = { version = "0.25", default-features = false } }`. A `path` is made absolute. |

## `[web]`

| key | default | |
|---|---|---|
| `out` | `<build out>/web` | Where `ceangal build web` writes the site. |
| `boot` | the generic one | A `boot.js` exporting `options()`: the start options, e.g. to add a JavaScript extension ([Native extensions](native.md)). |
| `files` | `[]` | Files copied over the generated page: your own `index.html`, a `manifest.webmanifest`, … |
| `prebuild` | none | A script run before the web build, with `WEB_OUT` set to the output directory. |

## `[linux]`

| key | default | |
|---|---|---|
| `id` | `[app] id` | The Flatpak application ID. Flathub checks that you control its domain; `io.github.<user>.<app>` works for a GitHub account. |

## `[store]`

| key | default | |
|---|---|---|
| `dir` | `"store"` | Icons per platform, the privacy policy and listing texts: see [Stores and signing](stores.md). |

## `[build]`

| key | default | |
|---|---|---|
| `out` | `"build"` | Where builds go. |

## Generated files

Every `ceangal` command also writes `almide.toml` (and Almide writes
`almide.lock`). They point editors and `almide check` at this machine's
copy of the framework, so they are listed in `.gitignore` and not
committed. An app that keeps its own `almide.toml`, without the
generated-file marker on its first line, is left alone.
