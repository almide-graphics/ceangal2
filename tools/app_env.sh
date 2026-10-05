# Sourced by the build and packaging scripts: the app's settings (APP_DIR,
# APP_ID, APP_NAME, … — docs/adr/0006) from its ceangal.toml. The ceangal
# CLI sets them when it runs a script; run on its own, a script builds
# $CEANGAL_APP (a directory with ceangal.toml, default apps/playground).
if [ -z "${APP_DIR:-}" ]; then
  _sdk="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  _app="${CEANGAL_APP:-$_sdk/apps/playground}"
  [ -d "$_app" ] || _app="$_sdk/apps/$_app"
  eval "$("$_sdk/tools/ceangal" env --app "$_app")"
  unset _sdk _app
fi

# Copy every asset directory (APP_ASSETS, one per line, the app's first)
# into $1; an app's file wins over the framework's of the same name.
app_copy_assets() {
  local d IFS=$'\n'
  mkdir -p "$1"
  for d in $APP_ASSETS; do [ -d "$d" ] && cp -Rn "$d/." "$1/"; done
  return 0
}

# Make sure $APP_STORE has the icons (tools/app_icons.py keeps existing ones).
app_icons() {
  [ -f "$APP_STORE/icon-1024.png" ] && [ -d "$APP_STORE/android" ] && [ -d "$APP_STORE/windows" ] \
    && [ -d "$APP_STORE/linux/icons" ] && [ -d "$APP_STORE/web" ] && [ -f "$APP_STORE/ios/AppIcon-1024.png" ] && return 0
  python3 -c 'import PIL' 2>/dev/null || python3 -m pip install --quiet --user pillow 2>/dev/null \
    || python3 -m pip install --quiet --user --break-system-packages pillow
  python3 "$CEANGAL_SDK/tools/app_icons.py"
}

# A build directory for the app ($1 names it: a target / OS tag): links to
# its sources and native modules and an almide.toml whose dependency paths
# are absolute — almide copies [native-deps] specs verbatim into a Cargo
# project elsewhere. Extra [native-deps] lines come as $2. Prints the path.
app_build_dir() {
  local sdk build entry_dir
  # Cargo on Windows wants native paths (git-bash gives /d/a/…).
  sdk="$(cygpath -m "$CEANGAL_SDK" 2>/dev/null || echo "$CEANGAL_SDK")"
  build="$CEANGAL_SDK/out/build/$APP_KEY-$1"
  rm -rf "$build"; mkdir -p "$build"
  entry_dir="$(dirname "$APP_ENTRY")"
  ln -s "$APP_DIR/$entry_dir" "$build/$entry_dir"
  [ -n "$APP_NATIVE_DIR" ] && ln -s "$APP_NATIVE_DIR" "$build/native"
  cat > "$build/almide.toml" <<TOML
[package]
name = "$APP_KEY"
version = "$APP_VERSION"

[dependencies]
ceangal = { path = "$sdk/ceangal" }
snaidhm = { path = "$sdk/snaidhm" }

[native-deps]
$APP_NATIVE_DEPS
${2:-}
TOML
  echo "$build"
}
