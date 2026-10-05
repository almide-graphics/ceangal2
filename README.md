# ceangal2

ceangal, rebuilt so that **one Almide program runs unchanged on the web, iOS,
macOS, Android, Windows and Linux** — and the Almide Playground built on it.

Every pixel is drawn by [snaidhm](snaidhm/) through one small host ABI
([docs/abi.md](docs/abi.md)); the browser and each native platform only
implement that ABI.

```
cli/              the ceangal CLI: new, dev, build, run, doctor (docs/adr/0006, 0007)
apps/playground   the Almide Playground (editor, runner, user GUI programs)
apps/todo         the demo app
apps/demo         the M0 demo
ceangal/          UI framework: views, flex layout, events, text, widgets
  native/         Rust host for native builds (window, input, IME, storage…)
snaidhm/          renderer: instanced SDF quads, glyph atlas, images
  native/gpu.rs   wgpu implementation of the gpu namespace
hosts/web/        JS host (WebGPU) — the same ABI for browsers
abi/              generated ABI manifest (tools/gen_bindings.py)
tools/            per-platform build and packaging scripts the CLI runs
store/            store listings, assets, checklists
docs/guide        the guide; docs/api, the generated API reference
```

## Make an app

```sh
curl -fsSL https://raw.githubusercontent.com/almide-graphics/ceangal2/main/install.sh | sh
#   Windows: irm https://raw.githubusercontent.com/almide-graphics/ceangal2/main/install.ps1 | iex
ceangal new hello && cd hello
ceangal dev                # http://localhost:8000, rebuilt and reloaded on save
ceangal dev macos          # the desktop app, restarted on save
ceangal run ios            # or android, web, linux, windows
ceangal build android      # store packages: web macos ios android linux windows
ceangal doctor             # what each platform needs on this machine
```

The [guide](docs/guide/README.md) covers the rest: [getting
started](docs/guide/getting-started.md), [building UI](docs/guide/ui.md),
[`ceangal.toml`](docs/guide/ceangal-toml.md), [the CLI](docs/guide/cli.md),
[stores and signing](docs/guide/stores.md) and [native
extensions](docs/guide/native.md), plus the generated [API
reference](docs/api/README.md). An app's CI is one line,
`uses: almide-graphics/ceangal2/.github/workflows/app.yml@v0.2.0`;
[ceangal-hello](https://github.com/almide-graphics/ceangal-hello) is an app
in its own repository, built for every platform by it.

Inside this repository, `tools/ceangal` runs the CLI from the checkout
(built on first use), and `CEANGAL_SDK=$PWD` makes new apps use the
checkout instead of a release.

## Repositories

- **This repository** is the framework and its reference apps: `ceangal/`,
  `snaidhm/`, the hosts, the CLI and tools, and the Almide Playground
  (`apps/playground`), which is built and released from here.
  ceangal and snaidhm stay together here while Almide git dependencies
  cannot name a package in a subdirectory (almide/almide#3381); a release
  is a tag (`v0.2.0`) that apps pin in `ceangal.toml`, with the CLI's
  binaries attached (`.github/workflows/release.yml`).
- **Apps** live in their own repositories, like
  [ceangal-hello](https://github.com/almide-graphics/ceangal-hello).
- The earlier [ceangal](https://github.com/almide-graphics/ceangal),
  [snaidhm](https://github.com/almide-graphics/snaidhm) and
  [ceangal-native](https://github.com/almide-graphics/ceangal-native) are
  archived; this repository replaces them.

## Build and run

```sh
cd apps/demo
../../tools/almide build src/main.almd -o ../../out/demo        # native, opens a window
../../tools/almide build src/main.almd --target wasm -o ../../out/demo.wasm
```

`tools/almide` downloads the Almide release pinned in `.almide-version`.

Headless (no window, writes a PNG):

```sh
CEANGAL_HEADLESS=out.png CEANGAL_SIZE=800x600 CEANGAL_SCRIPT="click 650 140" ./out/demo
```

## Tests

```sh
node tests/abi_conformance.mjs          # every ABI function exists in every host
(cd ceangal && ../tools/almide test src/layout_test.almd)
node tests/pixel/run.mjs                # web (headless Chrome, WebGPU) vs native pixels
```

## Status

See [PROGRESS.md](PROGRESS.md).
