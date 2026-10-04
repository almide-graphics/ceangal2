#!/usr/bin/env bash
# Assemble the web playground into dist/web (what GitHub Pages serves).
#   tools/build_web.sh            build everything
#   SKIP_COMPILER=1 tools/...     reuse out/compiler-pkg
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/dist/web"
almide="$root/tools/almide"
# rustup's cargo first: a distro cargo usually lacks the wasm32 target.
cargo="${CARGO:-$([ -x "$HOME/.cargo/bin/cargo" ] && echo "$HOME/.cargo/bin/cargo" || command -v cargo)}"
bindgen="${WASM_BINDGEN:-$([ -x "$HOME/.cargo/bin/wasm-bindgen" ] && echo "$HOME/.cargo/bin/wasm-bindgen" || command -v wasm-bindgen)}"

if [ -z "${SKIP_COMPILER:-}" ] || [ ! -f "$root/out/compiler-pkg/almide_compiler_service_bg.wasm" ]; then
  (cd "$root/apps/playground/compiler" && "$cargo" build --release --lib --target wasm32-unknown-unknown --features web)
  "$bindgen" --target web --no-typescript --out-dir "$root/out/compiler-pkg" \
    "$root/apps/playground/compiler/target/wasm32-unknown-unknown/release/almide_compiler_service.wasm"
fi

rm -rf "$out"
mkdir -p "$out/assets" "$out/compiler"
(cd "$root/apps/playground" && "$almide" build src/main.almd --target wasm -o "$out/playground.wasm")
node "$root/tests/wasm_stubs.mjs" "$out/playground.wasm"
cp "$root/apps/playground/web/index.html" "$root/apps/playground/web/boot.js" "$root/hosts/web/host.js" "$root/hosts/web/dom.js" "$root/hosts/web/gui.js" "$root/hosts/web/gui-worker.js" "$root/hosts/web/runner.js" "$root/hosts/web/runner-worker.js" "$out/"
cp -R "$root/hosts/web/vendor" "$out/vendor"
cp "$root/out/compiler-pkg/almide_compiler_service.js" "$root/out/compiler-pkg/almide_compiler_service_bg.wasm" "$out/compiler/"
cp -R "$root/assets/fonts" "$out/assets/fonts"
cp -R "$root/apps/playground/assets/examples" "$out/assets/examples"
cp -R "$root/apps/playground/assets/ai" "$out/assets/ai"
touch "$out/.nojekyll"
echo "dist/web: $(du -sh "$out" | cut -f1)"
