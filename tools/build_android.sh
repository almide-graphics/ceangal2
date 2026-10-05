#!/usr/bin/env bash
# Build an app for Android: the Almide program as a NativeActivity cdylib per
# ABI, packaged without Gradle (aapt2 + bundletool) into
#   $APP_OUT/android/<key>.aab   the Play upload (signed with the upload key)
#   $APP_OUT/android/<key>.apk   a universal APK for emulators and sideloading
#
#   tools/build_android.sh [app] [abi…]      (default ABIs: arm64-v8a x86_64)
# The app: `ceangal build android`, else the [app] argument (a directory or
# apps/<name>), else $CEANGAL_APP.
#
# Needs ANDROID_HOME (platforms;android-$ANDROID_API, build-tools, ndk), Rust
# targets aarch64-linux-android / x86_64-linux-android, and Java. Signing:
# ANDROID_KEYSTORE (+ ANDROID_KEYSTORE_PASS, ANDROID_KEY_ALIAS,
# ANDROID_KEY_PASS); without it a debug key in out/android/ is used.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
case "${1:-}" in ""|arm64-v8a|x86_64) ;; *) export CEANGAL_APP="$1"; shift ;; esac
abis=("$@"); [ ${#abis[@]} -gt 0 ] || abis=(arm64-v8a x86_64)

: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
api="${ANDROID_API:-37.0}"            # compile + target SDK
min_api=26                           # adaptive icons, AAudio, Vulkan 1.0
bt="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME/build-tools" | sort -V | tail -1)"
ndk="$ANDROID_HOME/ndk/$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
tc="$(echo "$ndk"/toolchains/llvm/prebuilt/*/bin)"
jar="$ANDROID_HOME/platforms/android-$api/android.jar"
[ -f "$jar" ] || jar="$ANDROID_HOME/platforms/android-${api%%.*}/android.jar"

source "$root/tools/app_env.sh"
app="$APP_KEY"
app_icons
icons="$APP_STORE/android"   # adaptive icon layers: fg-<dpi>.png (+ mono-<dpi>.png)
out="$APP_OUT/android"
work="$out/$app"
rm -rf "$work"; mkdir -p "$work"

bundletool="$out/bundletool-1.18.3.jar"
[ -f "$bundletool" ] || curl -sSfL -o "$bundletool" \
  https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar

# ── the native library, per ABI ──
for abi in "${abis[@]}"; do
  case "$abi" in
    arm64-v8a) triple=aarch64-linux-android ;;
    x86_64) triple=x86_64-linux-android ;;
    *) echo "unknown ABI $abi" >&2; exit 1 ;;
  esac
  up="$(echo "$triple" | tr 'a-z-' 'A-Z_')"
  export "CARGO_TARGET_${up}_LINKER=$tc/$triple$min_api-clang"
  export "CC_${triple//-/_}=$tc/$triple$min_api-clang"
  export "AR_${triple//-/_}=$tc/llvm-ar"
  # 16 KB pages (required for Android 15+ devices on Play). Thread locals:
  # std for Android implements `thread_local!` with one pthread key per
  # static, and bionic has ~128; generated Almide code has hundreds. std is
  # rebuilt with native (emulated) TLS instead — see docs/adr/0004.
  # Emulated TLS needs __emutls_get_address from clang's builtins, which rustc
  # (linking with -nodefaultlibs) does not pull in by itself.
  builtins="$(echo "$tc"/../lib/clang/*/lib/linux/libclang_rt.builtins-${triple%%-*}-android.a)"
  export "CARGO_TARGET_${up}_RUSTFLAGS=-C link-arg=-Wl,-z,max-page-size=16384 -Z has-thread-local=yes -C link-arg=$builtins"
  export RUSTC_BOOTSTRAP=1 CARGO_UNSTABLE_BUILD_STD=std,panic_abort
  mkdir -p "$work/lib/$abi"
  so="$work/lib/$abi/lib$app.so"
  CEANGAL_BUILD_TAG="android-$abi" "$root/tools/build_native.sh" -o "$so" --cdylib --target "$triple"
  "$tc/llvm-strip" --strip-unneeded "$so"
done

# ── resources: label + adaptive icon ──
res="$work/res"
mkdir -p "$res/values" "$res/drawable" "$res/mipmap-anydpi-v26"
esc() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e "s/'/\\\\'/g" <<<"$1"; }
cat > "$res/values/strings.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources><string name="app_name">$(esc "$APP_NAME")</string></resources>
XML
# APP_ICON_BG behind the foreground layer; the silhouette for themed icons
# when the app has one.
mono_line=""
for dpi in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
  mkdir -p "$res/mipmap-$dpi"
  cp "$icons/fg-$dpi.png" "$res/mipmap-$dpi/ic_launcher_foreground.png"
  if [ -f "$icons/mono-$dpi.png" ]; then
    cp "$icons/mono-$dpi.png" "$res/mipmap-$dpi/ic_launcher_monochrome.png"
    mono_line='<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>'
  fi
done
cat > "$res/values/colors.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources><color name="icon_bg">$APP_ICON_BG</color></resources>
XML
for name in ic_launcher ic_launcher_round; do
  cat > "$res/mipmap-anydpi-v26/$name.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/icon_bg"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
  $mono_line
</adaptive-icon>
XML
done

perm=""
[ "${APP_NETWORK:-0}" = 1 ] && perm='<uses-permission android:name="android.permission.INTERNET"/>'
cat > "$work/AndroidManifest.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="$APP_ID">
  $perm
  <!-- wgpu renders with Vulkan 1.1 (GLES is the fallback). -->
  <uses-feature android:name="android.hardware.vulkan.version" android:version="0x401000" android:required="false"/>
  <application android:label="@string/app_name"
      android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round"
      android:hasCode="false" android:extractNativeLibs="false"
      android:allowBackup="false" android:dataExtractionRules="@xml/data_extraction_rules"
      android:theme="@android:style/Theme.Material.NoActionBar">
    <activity android:name="android.app.NativeActivity" android:exported="true"
        android:launchMode="singleTask"
        android:windowSoftInputMode="adjustResize"
        android:configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboard|keyboardHidden|navigation|uiMode|density|fontScale|locale|layoutDirection">
      <meta-data android:name="android.app.lib_name" android:value="$app"/>
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>
XML
# Nothing leaves the device in backups or device transfer (API keys, drafts).
mkdir -p "$res/xml"
cat > "$res/xml/data_extraction_rules.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup><exclude domain="root"/><exclude domain="file"/><exclude domain="database"/><exclude domain="sharedpref"/><exclude domain="external"/></cloud-backup>
  <device-transfer><exclude domain="root"/><exclude domain="file"/><exclude domain="database"/><exclude domain="sharedpref"/><exclude domain="external"/></device-transfer>
</data-extraction-rules>
XML

# ── assets: the app's directories merged, earlier ones win ──
assets="$work/assets"
mkdir -p "$assets"
app_copy_assets "$assets"

# ── link (proto format for the bundle) and build the base module ──
"$bt/aapt2" compile --dir "$res" -o "$work/res.zip"
"$bt/aapt2" link --proto-format -o "$work/linked.apk" -I "$jar" \
  --manifest "$work/AndroidManifest.xml" --min-sdk-version "$min_api" \
  --target-sdk-version "${api%%.*}" --version-code "$APP_BUILD" --version-name "$APP_VERSION" \
  -A "$assets" "$work/res.zip"
mod="$work/base"
mkdir -p "$mod/manifest"
(cd "$mod" && unzip -q "$work/linked.apk")
mv "$mod/AndroidManifest.xml" "$mod/manifest/"
cp -R "$work/lib" "$mod/lib"
(cd "$mod" && zip -qr "$work/base.zip" .)
cat > "$work/BundleConfig.json" <<JSON
{ "optimizations": { "uncompressNativeLibraries": { "enabled": true, "alignment": "PAGE_ALIGNMENT_16K" } },
  "compression": { "uncompressedGlob": ["assets/fonts/**"] } }
JSON
rm -f "$out/$app.aab"
java -jar "$bundletool" build-bundle --modules="$work/base.zip" --config="$work/BundleConfig.json" --output="$out/$app.aab"

# ── signing ──
# jarsigner from the JDK that runs `java` (macOS puts a stub on PATH).
jdk_bin="${JAVA_HOME:+$JAVA_HOME/bin}"
[ -n "$jdk_bin" ] || jdk_bin="$(dirname "$(realpath "$(command -v java)")")"
if [ -n "${ANDROID_KEYSTORE:-}" ]; then
  ks="$ANDROID_KEYSTORE"; ks_pass="$ANDROID_KEYSTORE_PASS"; alias="$ANDROID_KEY_ALIAS"; key_pass="${ANDROID_KEY_PASS:-$ANDROID_KEYSTORE_PASS}"
else
  ks="$out/debug.keystore"; ks_pass=android; alias=androiddebugkey; key_pass=android
  [ -f "$ks" ] || "$jdk_bin/keytool" -genkeypair -keystore "$ks" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >/dev/null
fi
"$jdk_bin/jarsigner" -keystore "$ks" -storepass "$ks_pass" -keypass "$key_pass" -sigalg SHA256withRSA -digestalg SHA-256 \
  "$out/$app.aab" "$alias" >/dev/null

rm -f "$work/universal.apks"
java -jar "$bundletool" build-apks --bundle="$out/$app.aab" --output="$work/universal.apks" --mode=universal \
  --ks="$ks" --ks-pass="pass:$ks_pass" --ks-key-alias="$alias" --key-pass="pass:$key_pass"
(cd "$work" && unzip -qo universal.apks universal.apk && mv universal.apk "$out/$app.apk")

# ── checks: 16 KB alignment of every native library, signature ──
"$bt/zipalign" -c -P 16 -v 4 "$out/$app.apk" | grep -E '\.so|Verification' || true
"$bt/zipalign" -c -P 16 4 "$out/$app.apk"
"$bt/apksigner" verify "$out/$app.apk"
java -jar "$bundletool" validate --bundle="$out/$app.aab" >/dev/null
echo "built $out/$app.aab and $out/$app.apk (${abis[*]})"
