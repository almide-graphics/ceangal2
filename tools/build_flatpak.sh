#!/usr/bin/env bash
# Build the Flatpak (Linux): stage the exported Rust project, the assets and
# the desktop files, turn Cargo.lock into offline sources, build with
# flatpak-builder (no network during the build) and lint it like Flathub.
#
#   tools/build_flatpak.sh     → $APP_OUT/flatpak/<linux id>.flatpak
#
# The app's own <store>/linux/<linux id>.{yml,desktop,metainfo.xml} are used
# when present; otherwise they are written from ceangal.toml (a metainfo
# without screenshots builds, but Flathub's linter wants them: add your own
# file before submitting).
#
# Needs flatpak, flatpak-builder, org.freedesktop.{Platform,Sdk}//26.08, the
# rust-stable extension, org.flatpak.Builder (flathub-build and the linter), python3 with
# aiohttp + tomlkit (flatpak-cargo-generator), and network for the staging.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/tools/app_env.sh"
id="$APP_LINUX_ID"
export CEANGAL_APP_ID="$id"
out="$APP_OUT/flatpak"
stage="$out/stage"
rm -rf "$stage" "$out/build" "$out/repo"; mkdir -p "$stage/linux"
app_icons

"$root/tools/export_rust_project.sh" "$stage/src"
app_copy_assets "$stage/assets"
cp -R "$APP_STORE/linux/icons" "$stage/icons"
[ -d "$APP_STORE/linux" ] && cp -R "$APP_STORE/linux/." "$stage/linux/"
almide_v="$(cat "$root/.almide-version")"
ALMIDE_SRC_SHA256="$(curl -fsSL "https://github.com/almide/almide/archive/refs/tags/v$almide_v.tar.gz" | shasum -a 256 | cut -d' ' -f1)" \
  python3 "$root/tools/flatpak_files.py" "$stage/linux" "$out/$id.yml" "$almide_v"

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

# Flathub's linter on the manifest and the built repository. With a
# metainfo written from ceangal.toml (no screenshots, a one-line
# description) its findings are warnings: the app is not ready for Flathub
# until it has its own.
lint() {
  flatpak run --command=flatpak-builder-lint org.flatpak.Builder "$@" && return 0
  [ -f "$APP_STORE/linux/$id.metainfo.xml" ] && return 1
  echo "warning: Flathub's linter: add $APP_STORE/linux/$id.metainfo.xml (screenshots, description) before submitting" >&2
}
lint manifest "$out/$id.yml"
lint repo "$out/repo"
echo "built $out/$id.flatpak"
