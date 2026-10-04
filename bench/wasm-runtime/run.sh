#!/usr/bin/env bash
# Rebuild the benchmark programs (heavy + playground examples) to wasm and
# compare Pulley, wasmi and Cranelift. See docs/adr/0003-wasm-runtime.md.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$here/../.."
work="$here/target/progs"; rm -rf "$work"; mkdir -p "$work"
build() { # name, dir with .almd files
  local d="$work/src-$1"; mkdir -p "$d/src"; cp "$2"/*.almd "$d/src/"
  printf '[package]\nname = "p"\nversion = "0.1.0"\n' > "$d/almide.toml"
  (cd "$d" && "$root/tools/almide" build src/main.almd --target wasm -o "$work/$1.wasm" >/dev/null)
}
build heavy "$here/progs/heavy"
for ex in fizzbuzz mandelbrot fern voronoi mini-markdown; do build "$ex" "$root/apps/playground/assets/examples/$ex"; done
cargo run --release --manifest-path "$here/Cargo.toml" -- "$work"
