#!/usr/bin/env bash
# Build the Flatpak (Linux): stage the exported Rust project, the assets and
# the desktop files, turn Cargo.lock into offline sources, build with
# flatpak-builder (no network during the build) and lint it like Flathub.
#
#   tools/build_flatpak.sh            → out/flatpak/io.github.almide.playground.flatpak
#
# Needs flatpak, flatpak-builder, org.freedesktop.{Platform,Sdk}//26.08, the
# rust-stable extension, org.flatpak.Builder (flathub-build and the linter), python3 with
# aiohttp + tomlkit (flatpak-cargo-generator), and network for the staging.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
id=io.github.almide.playground
out="$root/out/flatpak"
stage="$out/stage"
rm -rf "$stage" "$out/build" "$out/repo"; mkdir -p "$stage"

"$root/tools/export_rust_project.sh" "$stage/src"
source "$root/apps/playground/app.env"
mkdir -p "$stage/assets"
for d in $APP_ASSETS; do cp -Rn "$root/$d/." "$stage/assets/"; done
cp -R "$root/store/playground/linux" "$stage/linux"
cp -R "$root/store/playground/linux/icons" "$stage/icons"
cp "$root/store/playground/linux/$id.yml" "$out/$id.yml"

gen="$out/flatpak-cargo-generator.py"
[ -f "$gen" ] || curl -fsSL -o "$gen" https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/master/cargo/flatpak-cargo-generator.py
python3 "$gen" "$stage/src/app/Cargo.lock" -o "$out/cargo-sources.json"

# appstream + desktop file checks before the long build
desktop-file-validate "$stage/linux/$id.desktop"
flatpak run --command=flatpak-builder-lint org.flatpak.Builder appstream "$stage/linux/$id.metainfo.xml" || true

# Built the way Flathub builds it: flathub-build (in org.flatpak.Builder)
# runs flatpak-builder with Flathub's options, mirrors the metainfo's
# screenshots and remote icons and commits them, so the linter sees what
# Flathub's infrastructure would publish.
(cd "$out" && rm -rf repo builddir && flatpak run --command=flathub-build org.flatpak.Builder "$id.yml")
flatpak build-bundle "$out/repo" "$out/$id.flatpak" "$id"

# Flathub's linter on the manifest and the built repository
flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest "$out/$id.yml"
flatpak run --command=flatpak-builder-lint org.flatpak.Builder repo "$out/repo"
echo "built $out/$id.flatpak"
