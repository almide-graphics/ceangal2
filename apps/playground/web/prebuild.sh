#!/usr/bin/env bash
# The playground's compiler for the web build (ceangal.toml `[web] prebuild`):
# the Almide compiler service as wasm-bindgen output in $WEB_OUT/compiler.
#   SKIP_COMPILER=1   reuse out/compiler-pkg when it is there
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$CEANGAL_SDK/out/compiler-pkg"
# rustup's cargo first: a distro cargo usually lacks the wasm32 target.
cargo="${CARGO:-$([ -x "$HOME/.cargo/bin/cargo" ] && echo "$HOME/.cargo/bin/cargo" || command -v cargo)}"
bindgen="${WASM_BINDGEN:-$([ -x "$HOME/.cargo/bin/wasm-bindgen" ] && echo "$HOME/.cargo/bin/wasm-bindgen" || command -v wasm-bindgen)}"
if [ -z "${SKIP_COMPILER:-}" ] || [ ! -f "$pkg/almide_compiler_service_bg.wasm" ]; then
  (cd "$here/compiler" && "$cargo" build --release --lib --target wasm32-unknown-unknown --features web)
  "$bindgen" --target web --no-typescript --out-dir "$pkg" \
    "$here/compiler/target/wasm32-unknown-unknown/release/almide_compiler_service.wasm"
fi
mkdir -p "$WEB_OUT/compiler"
cp "$pkg/almide_compiler_service.js" "$pkg/almide_compiler_service_bg.wasm" "$WEB_OUT/compiler/"
