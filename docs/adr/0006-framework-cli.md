# ADR 0006 — ceangal as a framework: `ceangal.toml` and the `ceangal` CLI

## Context
Everything under `ceangal/`, `snaidhm/` and `hosts/` is app-agnostic, but
the build and store tooling grew around the playground: `build_web.sh` and
`build_native.sh` named its paths and its compiler crate, the Flatpak and
MSIX scripts read `apps/playground`, and an app's identity was spread over
`app.env` (shell variables) and `store/<app>/`. The goal is a framework in
the sense of Flutter or React Native: an app in its own repository, built,
run and packaged for every platform with one tool.

## Decision
- **An app is a directory with `ceangal.toml`** and Almide sources. Paths
  are relative to the app; every key but `[app] id` has a default.

  ```toml
  [app]
  id = "dev.example.todo"      # reverse-DNS: bundle ID / application ID
  name = "Todo"
  description = "A small to-do list"   # stores, launchers, the web page
  publisher = "Example"        # MSIX, metainfo (default: the name)
  version = "0.1.0"
  build = 1                    # store build number (CFBundleVersion, versionCode)
  entry = "src/main.almd"
  icon = "icon.png"            # 1024 px, edge to edge; none = the name's initial
  icon_background = "#2E7D32"  # Android adaptive icon ground, tiles, web theme
  assets = ["assets"]          # merged over the framework's (fonts)
  network = false              # INTERNET permission, sandbox network client
  category = "public.app-category.productivity"   # macOS
  languages = ["en-us"]        # MSIX resources
  copyright = ""

  [framework]
  path = "../ceangal2"         # a checkout — or version = "0.1.0" (tag v0.1.0)

  [native]                     # extra Rust for the native builds
  dir = "native"               # @extern(rust) modules
  deps = { serde_json = "1" }  # Cargo specs; `path` entries made absolute

  [web]
  out = "dist/web"             # default <build out>/web
  boot = "web/boot.js"         # replaces the generic start options
  files = ["web/index.html"]   # copied over the generic page
  prebuild = "web/prebuild.sh" # runs with WEB_OUT set

  [linux]
  id = "io.github.example.todo"   # Flathub verifies the ID's domain

  [store]
  dir = "store"                # icons per platform, privacy policy, listing

  [build]
  out = "build"
  ```

- **The CLI is an Almide program** (`cli/`; `tools/ceangal` builds it on
  first use). Commands: `new`, `build <target>` (web native macos ios
  ios-sim android linux windows), `run <target>` (web, the desktop OSes,
  ios, android), `icons`, `env`, `info`. It resolves the framework
  (`[framework] path`, else `$CEANGAL_SDK`, else `~/.ceangal/sdk/<version>`
  cloned at tag `v<version>`) and runs the per-platform scripts in `tools/`
  with the app's settings as environment variables (`APP_DIR`, `APP_ID`,
  `APP_NAME`, … — `ceangal env` prints them).
  - Child processes run with the terminal's stdio and report their exit
    code through a small `@extern(rust)` helper: the stdlib can capture
    output or spawn without waiting, not both (almide/almide#3379).
  - `ceangal.toml` is parsed by the `toml` crate on the Rust side and read
    as JSON: almide/toml does not build with Almide 0.66 (almide/toml#2).
  - Every command writes the app's `almide.toml` (marked as generated, not
    committed) with `path` dependencies to the resolved framework, for
    editors and `almide check`: git dependencies cannot name a package in a
    subdirectory of a repository (almide/almide#3381). An app that keeps
    its own `almide.toml` (no marker) is left alone, as the apps here do.
- **The tools take the app from the environment**: no script names an app.
  Run on their own they ask the CLI for `$CEANGAL_APP`'s settings
  (`tools/app_env.sh`; default `apps/playground`), so this repository's CI
  invokes them as before. Whatever was playground-only became playground
  configuration — its compiler crate is a `[native] deps` entry, its
  compiler build a web `prebuild`, its runner extension a web `boot`, its
  page a web `files` entry. Each build goes through one generated
  directory (`app_build_dir`): links to the app's sources and native
  modules, an `almide.toml` with absolute paths.
- **Icons come from one picture**: `ceangal icons` (`tools/app_icons.py`)
  writes every size each platform and store wants into the app's store
  directory, keeping files that are already there, so hand-made ones (the
  playground's, from `tools/build_brand.py`) win. Builds make the missing
  ones on the way. Store files an app does not provide are written from
  `ceangal.toml`: the web page, manifest and boot script
  (`tools/templates/web`), the privacy manifest (what the framework itself
  touches), the Flatpak manifest, desktop entry and metainfo.
- **Apps live in their own repositories**; their CI is the reusable
  workflow `.github/workflows/app.yml` (`ceangal new` writes the caller),
  which checks out the framework at the version the app names and builds
  every platform, opening the web build in headless Chrome and starting
  the Mac app once. `apps/playground` and `apps/todo` stay here as the
  reference apps; this repository's `framework` CI job makes an app with
  `ceangal new` outside the repository and builds it.

## Consequences
- An app's whole store identity is in `ceangal.toml` and its store
  directory; `app.env` and `store/<app>/icon.env` are gone.
- A framework release is a git tag; apps pin it in `[framework] version`.
- A Flatpak built from a generated metainfo has no screenshots and a
  one-line description: Flathub's linter findings are warnings until the
  app adds its own metainfo, then they fail the build as for the
  playground.
- `ceangal dev` (rebuild on change) and `ceangal test` (the app's E2E) are
  not there yet; the reference apps' E2E stays in `tests/`.
