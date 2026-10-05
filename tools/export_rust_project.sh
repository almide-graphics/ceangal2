#!/usr/bin/env bash
# Export the app as a self-contained Rust project: the Rust that almide
# generates from the Almide sources, the native modules, the crates the app
# names by path and a Cargo.lock. This is what offline builds compile
# (Flatpak: flatpak-cargo-generator turns the lock into sources, cargo builds
# --offline). Needs network (almide resolves crates once).
#
#   tools/export_rust_project.sh [out-dir]     (default: $APP_OUT/rust-project)
#
# Layout: app/ (the crate), the framework's sources as in its repository
# (ceangal/src, snaidhm/src), and each path crate where it sits relative to
# the framework (sdk/…) or to the app (appdir/…), so build scripts that
# reach their neighbours (the playground's compiler embeds ../../../ceangal)
# still find them.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/tools/app_env.sh"
dst="${1:-$APP_OUT/rust-project}"
case "$dst" in /*) ;; *) dst="$PWD/$dst" ;; esac
tmp="$root/out/export-tmp"
rm -rf "$tmp" "$dst"; mkdir -p "$tmp" "$dst"

# Build once with a private temp dir, so the generated project is ours alone.
TMPDIR="$tmp" CEANGAL_BUILD_TAG=export "$root/tools/build_native.sh" -o "$tmp/$APP_KEY"
gen="$tmp/almide-run"
[ -f "$gen/Cargo.lock" ] || { echo "no generated project in $gen" >&2; exit 1; }

# the generated crate: main.rs, the native modules it declares, their folders
mkdir -p "$dst/app/src"
cp "$gen/Cargo.toml" "$gen/Cargo.lock" "$dst/app/"
cp "$gen/src/main.rs" "$dst/app/src/"
for d in "$root/ceangal/native" "$root/snaidhm/native" ${APP_NATIVE_DIR:+"$APP_NATIVE_DIR"}; do
  for f in "$d"/*; do
    [ -e "$f" ] || continue
    cp -R "$f" "$dst/app/src/"
  done
done
mkdir -p "$dst/sdk/ceangal" "$dst/sdk/snaidhm"
cp -R "$root/ceangal/src" "$dst/sdk/ceangal/src"
cp -R "$root/snaidhm/src" "$dst/sdk/snaidhm/src"

# path crates: copied next to their neighbours, the manifest made relative
python3 - "$dst" "$root" "$APP_DIR" <<'PY'
import os, re, shutil, sys
dst, sdk, app = sys.argv[1:]
manifest = os.path.join(dst, "app", "Cargo.toml")
text = open(manifest, encoding="utf-8").read()
def move(m):
    p = os.path.realpath(m.group(1))
    for base, name in ((os.path.realpath(sdk), "sdk"), (os.path.realpath(app), "appdir")):
        if p == base or p.startswith(base + os.sep):
            rel = os.path.join(name, os.path.relpath(p, base))
            break
    else:
        sys.exit(f"path dependency outside the framework and the app: {p}")
    target = os.path.join(dst, rel)
    if not os.path.exists(target):
        shutil.copytree(p, target, ignore=shutil.ignore_patterns("target", ".git"))
    return f'path = "../{rel}"'
text = re.sub(r'path = "(/[^"]+)"', move, text)
open(manifest, "w", encoding="utf-8").write(text)
PY
echo "exported $dst"
