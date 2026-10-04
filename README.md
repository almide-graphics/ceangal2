# ceangal2

ceangal, rebuilt so that **one Almide program runs unchanged on the web, iOS,
macOS, Android, Windows and Linux** — and the Almide Playground built on it.

Every pixel is drawn by [snaidhm](snaidhm/) through one small host ABI
([docs/abi.md](docs/abi.md)); the browser and each native platform only
implement that ABI.

```
apps/playground   the Almide Playground (editor, runner, user GUI programs)
apps/demo         the M0 demo
ceangal/          UI framework: views, flex layout, events, text, widgets
  native/         Rust host for native builds (window, input, IME, storage…)
snaidhm/          renderer: instanced SDF quads, glyph atlas, images
  native/gpu.rs   wgpu implementation of the gpu namespace
hosts/web/        JS host (WebGPU) — the same ABI for browsers
abi/              generated ABI manifest (tools/gen_bindings.py)
store/            store listings, assets, checklists
```

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
