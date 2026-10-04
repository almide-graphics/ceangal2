#!/usr/bin/env bash
# The macOS app for the Mac App Store: a universal (arm64 + x86_64) bundle
# with App Sandbox, signed, wrapped in an installer pkg.
#
#   tools/package_macos.sh [app]        (default: playground)
#   → out/macos/<Name>.app, out/macos/<app>.pkg
#
# Signing (from secrets in CI): MAC_APP_IDENTITY ("3rd Party Mac Developer
# Application: …" / "Apple Distribution: …"), MAC_INSTALLER_IDENTITY
# ("3rd Party Mac Developer Installer: …"), MAC_PROVISIONING_PROFILE (path to
# the .provisionprofile). Without them the app is signed ad hoc and the pkg
# is unsigned — enough to check the sandbox locally, not to upload.
# MAC_ARCHS="arm64" builds one architecture (faster local runs).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
app="${1:-playground}"
# shellcheck disable=SC1090
source "$root/apps/$app/app.env"
out="$root/out/macos"
bundle="$out/$APP_NAME.app"
rm -rf "$bundle" "$out/$app.pkg"; mkdir -p "$out"
archs=(${MAC_ARCHS:-arm64 x86_64})

# ── the binary, per architecture, then lipo ──
bins=()
for arch in "${archs[@]}"; do
  case "$arch" in
    arm64) triple=aarch64-apple-darwin ;;
    x86_64) triple=x86_64-apple-darwin ;;
  esac
  bin="$out/$app-$arch"
  export CEANGAL_APP_ID="$APP_ID" MACOSX_DEPLOYMENT_TARGET=12.0
  if [ "$app" = playground ]; then
    CEANGAL_BUILD_TAG="macos-$arch" "$root/tools/build_native.sh" -o "$bin" --target "$triple"
  else
    build="$root/out/build/$app-macos-$arch"
    rm -rf "$build"; mkdir -p "$build"
    ln -s "$root/apps/$app/src" "$build/src"
    sed -e "s#\"\.\./\.\./#\"$root/#g" "$root/apps/$app/almide.toml" > "$build/almide.toml"
    (cd "$build" && "$root/tools/almide" build src/main.almd --release --target "$triple" -o "$bin")
  fi
  bins+=("$bin")
done
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources/assets"
lipo -create "${bins[@]}" -output "$bundle/Contents/MacOS/$app"
lipo -info "$bundle/Contents/MacOS/$app"

# ── resources: assets (the host looks in Contents/Resources/assets), icon ──
for d in $APP_ASSETS; do cp -Rn "$root/$d/." "$bundle/Contents/Resources/assets/"; done
icns="$root/store/$app/macos/AppIcon.icns"
[ -f "$icns" ] && cp "$icns" "$bundle/Contents/Resources/AppIcon.icns"
# the privacy manifest (required for App Store apps)
cp "$root/store/$app/ios/PrivacyInfo.xcprivacy" "$bundle/Contents/Resources/" 2>/dev/null || true

cat > "$bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$APP_ID</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>$app</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION_CODE</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleSupportedPlatforms</key><array><string>MacOSX</string></array>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
  <key>ITSAppUsesNonExemptEncryption</key><false/>
  <key>NSHumanReadableCopyright</key><string>© Almide contributors</string>
</dict>
</plist>
PLIST
plutil -lint "$bundle/Contents/Info.plist" >/dev/null

# ── entitlements: the sandbox, plus only what the app uses ──
ent="$out/$app.entitlements"
{
  cat <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key><true/>
  <!-- Open / Save dialogs (export a project, open a file) -->
  <key>com.apple.security.files.user-selected.read-write</key><true/>
XML
  [ "${APP_NETWORK:-0}" = 1 ] && echo '  <!-- the AI assistant calls the provider the user picked -->
  <key>com.apple.security.network.client</key><true/>'
  echo '</dict>'
  echo '</plist>'
} > "$ent"
plutil -lint "$ent" >/dev/null

# ── sign ──
if [ -n "${MAC_PROVISIONING_PROFILE:-}" ]; then
  cp "$MAC_PROVISIONING_PROFILE" "$bundle/Contents/embedded.provisionprofile"
fi
identity="${MAC_APP_IDENTITY:--}"
codesign --force --options runtime --timestamp=none --entitlements "$ent" --sign "$identity" "$bundle"
codesign --verify --strict --verbose=2 "$bundle"
codesign -d --entitlements - "$bundle" 2>/dev/null | grep -q app-sandbox

# ── installer pkg (what the Mac App Store takes) ──
if [ -n "${MAC_INSTALLER_IDENTITY:-}" ]; then
  productbuild --component "$bundle" /Applications --sign "$MAC_INSTALLER_IDENTITY" "$out/$app.pkg"
else
  productbuild --component "$bundle" /Applications "$out/$app.pkg"
fi
echo "built $bundle and $out/$app.pkg (${archs[*]})"
