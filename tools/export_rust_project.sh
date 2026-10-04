#!/usr/bin/env bash
# Export the playground as a self-contained Rust project: the Rust that
# almide generates from the Almide sources, the native modules, the compiler
# crate and a Cargo.lock. This is what offline builds compile (Flatpak:
# flatpak-cargo-generator turns the lock into sources, cargo builds
# --offline). Needs network (almide resolves crates once).
#
#   tools/export_rust_project.sh [out-dir]     (default: out/rust-project)
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dst="${1:-$root/out/rust-project}"
case "$dst" in /*) ;; *) dst="$PWD/$dst" ;; esac
tmp="$root/out/export-tmp"
rm -rf "$tmp" "$dst"; mkdir -p "$tmp" "$dst"

# Build once with a private temp dir, so the generated project is ours alone.
TMPDIR="$tmp" CEANGAL_BUILD_TAG=export "$root/tools/build_native.sh" -o "$tmp/playground"
gen="$tmp/almide-run"
[ -f "$gen/Cargo.lock" ] || { echo "no generated project in $gen" >&2; exit 1; }

# the generated crate: main.rs, the native modules it declares, their folders
mkdir -p "$dst/app/src"
cp "$gen/Cargo.toml" "$gen/Cargo.lock" "$dst/app/"
cp "$gen/src/main.rs" "$dst/app/src/"
for d in "$root/ceangal/native" "$root/snaidhm/native" "$root/apps/playground/native"; do
  for f in "$d"/*; do
    [ -e "$f" ] || continue
    cp -R "$f" "$dst/app/src/"
  done
done

# the compiler crate (an absolute path in the generated manifest), laid out
# as in the repository: its build.rs embeds ../../../{ceangal,snaidhm}/src
mkdir -p "$dst/apps/playground" "$dst/ceangal" "$dst/snaidhm"
cp -R "$root/apps/playground/compiler" "$dst/apps/playground/compiler"
rm -rf "$dst/apps/playground/compiler/target"
cp -R "$root/ceangal/src" "$dst/ceangal/src"
cp -R "$root/snaidhm/src" "$dst/snaidhm/src"
abs="$(cd "$root/apps/playground/compiler" && pwd)"
sed -i.bak -e "s#path = \"$abs\"#path = \"../apps/playground/compiler\"#" "$dst/app/Cargo.toml" && rm "$dst/app/Cargo.toml.bak"
grep -q 'path = "../apps/playground/compiler"' "$dst/app/Cargo.toml" || { echo "compiler path not rewritten" >&2; exit 1; }
echo "exported $dst"
