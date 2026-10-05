#!/usr/bin/env bash
# Build the app ($CEANGAL_APP, default the playground) as a native executable.
#   tools/build_native.sh [-o OUT] [extra almide build args…]
# Default OUT: $APP_OUT/native/$APP_KEY. With --cdylib (mobile), -o names the
# shared library to produce. CEANGAL_BUILD_TAG separates build directories
# (default: the host OS).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/tools/app_env.sh"
out="$APP_OUT/native/$APP_KEY"
if [ "${1:-}" = "-o" ]; then out="$2"; shift 2; fi
case "$out" in /*|[A-Za-z]:*) ;; *) out="$PWD/$out" ;; esac
# almide/almide#3346: cdylib builds (Android) omit flate2 for zlib users;
# bin builds add it themselves, and a second key is a Cargo error.
cdylib_deps=""
[[ " $* " == *" --cdylib "* ]] && cdylib_deps='flate2 = "1"'
build="$(app_build_dir "${CEANGAL_BUILD_TAG:-$(uname -s)}" "$cdylib_deps")"
mkdir -p "$(dirname "$out")"
# Baked into the binary: data directory and keychain entries live under it.
export CEANGAL_APP_ID="${CEANGAL_APP_ID:-$APP_ID}"
if [[ " $* " == *" --cdylib "* ]]; then
  # almide names a cdylib's crate after -o and writes lib<name>.so here.
  (cd "$build" && "$root/tools/almide" build "$APP_ENTRY" --release -o "$APP_KEY" "$@")
  mv "$build"/lib"$APP_KEY".* "$out"
else
  (cd "$build" && "$root/tools/almide" build "$APP_ENTRY" --release -o "$out" "$@")
fi
echo "built $out"
