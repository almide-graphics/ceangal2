#!/usr/bin/env bash
# Build the native playground (the Almide compiler and wasmi linked in).
#   tools/build_native.sh [-o out/playground] [extra almide build args…]
# almide copies [native-deps] specs verbatim into a Cargo project in a
# scratch directory, so the compiler crate's path must be absolute: this
# writes a build manifest with absolute paths next to the app's sources.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
# Cargo on Windows wants native paths (git-bash gives /d/a/…).
nroot="$(cygpath -m "$root" 2>/dev/null || echo "$root")"
out="$root/out/playground"
if [ "${1:-}" = "-o" ]; then out="$2"; shift 2; fi
case "$out" in /*|[A-Za-z]:*) ;; *) out="$PWD/$out" ;; esac
build="$root/out/build/playground-$(uname -s)"
rm -rf "$build"; mkdir -p "$build"
ln -s "$root/apps/playground/src" "$build/src"
ln -s "$root/apps/playground/native" "$build/native"
cat > "$build/almide.toml" <<TOML
[package]
name = "playground"
version = "0.1.0"

[dependencies]
ceangal = { path = "$nroot/ceangal" }
snaidhm = { path = "$nroot/snaidhm" }

[native-deps]
almide-compiler-service = { path = "$nroot/apps/playground/compiler" }
wasmi = "2"
serde_json = "1"
TOML
mkdir -p "$(dirname "$out")"
# Baked into the binary: data directory and keychain entries live under it.
export CEANGAL_APP_ID="${CEANGAL_APP_ID:-dev.almide.playground}"
(cd "$build" && "$root/tools/almide" build src/main.almd --release -o "$out" "$@")
echo "built $out"
