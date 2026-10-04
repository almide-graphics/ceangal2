#!/usr/bin/env bash
# Build the native playground (the Almide compiler and wasmi linked in).
#   tools/build_native.sh [-o out/playground] [extra almide build args…]
# almide copies [native-deps] specs verbatim into a Cargo project in a
# scratch directory, so the compiler crate's path must be absolute: this
# writes a build manifest with absolute paths next to the app's sources.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/out/playground"
if [ "${1:-}" = "-o" ]; then out="$2"; shift 2; fi
build="$root/out/build/playground"
rm -rf "$build"; mkdir -p "$build"
ln -s "$root/apps/playground/src" "$build/src"
ln -s "$root/apps/playground/native" "$build/native"
cat > "$build/almide.toml" <<TOML
[package]
name = "playground"
version = "0.1.0"

[dependencies]
ceangal = { path = "$root/ceangal" }
snaidhm = { path = "$root/snaidhm" }

[native-deps]
almide-compiler-service = { path = "$root/apps/playground/compiler" }
wasmi = "2"
serde_json = "1"
TOML
mkdir -p "$(dirname "$out")"
# Baked into the binary: data directory and keychain entries live under it.
export CEANGAL_APP_ID="${CEANGAL_APP_ID:-dev.almide.playground}"
(cd "$build" && "$root/tools/almide" build src/main.almd --release -o "$out" "$@")
echo "built $out"
