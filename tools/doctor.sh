#!/usr/bin/env bash
# `ceangal doctor [target…]`: what each target needs on this machine and
# whether it is there. Without targets it checks every one this OS can build
# and only reports; with targets it fails when one of theirs is missing.
set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

os="$(uname -s)"
case "$os" in
  Darwin) all=(web native macos ios android) ;;
  Linux) all=(web native linux android) ;;
  MINGW*|MSYS*|CYGWIN*) all=(web native windows android) ;;
  *) all=(web native) ;;
esac
strict=1
targets=("$@")
[ ${#targets[@]} -eq 0 ] && { targets=("${all[@]}"); strict=0; }

missing=0
ok() { printf '  ok       %s\n' "$1"; }
no() { printf '  missing  %s\n           → %s\n' "$1" "$2"; missing=$((missing + 1)); }
has() { command -v "$1" >/dev/null 2>&1; }
rustup="$(command -v rustup || echo "${CARGO_HOME:-$HOME/.cargo}/bin/rustup")"
check() { # check <what> <hint> <command…>
  local what="$1" hint="$2"; shift 2
  if "$@" >/dev/null 2>&1; then ok "$what"; else no "$what" "$hint"; fi
}
rust_target() {
  local t
  for t in "$@"; do
    check "Rust target $t" "rustup target add $t" sh -c "'$rustup' target list --installed 2>/dev/null | grep -qx '$t'"
  done
}
android_home="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -z "$android_home" ] && [ -d "$HOME/Library/Android/sdk" ] && android_home="$HOME/Library/Android/sdk"
[ -z "$android_home" ] && [ -d "$HOME/Android/Sdk" ] && android_home="$HOME/Android/Sdk"

common() {
  echo "common"
  check "Almide $(tr -d '[:space:]' < "$root/.almide-version") (tools/almide downloads it)" \
    "check the network: tools/almide fetches github.com/almide/almide releases" "$root/tools/almide" --version
  check "cargo (Rust)" "https://rustup.rs" has cargo
  check "rustup" "https://rustup.rs" test -x "$rustup"
  check "python3 with Pillow (icons)" "python3 -m pip install --user pillow" python3 -c 'import PIL'
}

target() {
  echo "$1"
  case "$1" in
    web)
      check "node (the web build's checks and tests)" "https://nodejs.org (20 or later)" has node ;;
    native) ;;
    macos)
      check "Xcode command line tools (lipo, codesign)" "xcode-select --install" has lipo
      rust_target aarch64-apple-darwin x86_64-apple-darwin ;;
    ios)
      check "Xcode" "install Xcode from the App Store, then: sudo xcode-select -s /Applications/Xcode.app" xcodebuild -version
      if has xcodegen || [ -x "$root/out/tools/xcodegen/bin/xcodegen" ]; then ok "xcodegen"
      else echo "  note     xcodegen: the first iOS build downloads it (or: brew install xcodegen)"; fi
      check "iOS simulator runtime" "Xcode → Settings → Components → iOS" sh -c "xcrun simctl list runtimes | grep -q iOS"
      rust_target aarch64-apple-ios aarch64-apple-ios-sim ;;
    android)
      if [ -n "$android_home" ] && [ -d "$android_home" ]; then ok "Android SDK ($android_home)"; else
        no "Android SDK" "install Android Studio (or the command-line tools) and set ANDROID_HOME"; fi
      check "Android NDK" "sdkmanager 'ndk;30.0.16248370'" sh -c "ls '$android_home/ndk' | grep -q ."
      check "Android build-tools" "sdkmanager 'build-tools;37.0.0'" sh -c "ls '$android_home/build-tools' | grep -q ."
      check "Android platform ${ANDROID_API:-37.0}" "sdkmanager 'platforms;android-${ANDROID_API:-37.0}'" \
        test -f "$android_home/platforms/android-${ANDROID_API:-37.0}/android.jar"
      check "Java 21" "https://adoptium.net, or the JDK in Android Studio (set JAVA_HOME)" java -version
      rust_target aarch64-linux-android x86_64-linux-android
      [ -n "${ANDROID_KEYSTORE:-}" ] && ok "upload key (ANDROID_KEYSTORE)" \
        || echo "  note     builds are signed with a debug key until ANDROID_KEYSTORE is set (docs/guide/stores.md)" ;;
    linux)
      check "flatpak-builder (Flatpak packages)" "sudo apt install flatpak-builder (then: flatpak remote-add --user flathub …)" has flatpak-builder
      check "Vulkan loader (the app draws with wgpu)" "sudo apt install libvulkan1 mesa-vulkan-drivers" sh -c "ldconfig -p | grep -q libvulkan.so.1"
      check "xkbcommon (keyboard input under X11 and Wayland)" "sudo apt install libxkbcommon-x11-0" sh -c "ldconfig -p | grep -q libxkbcommon-x11.so" ;;
    windows)
      check "PowerShell" "https://aka.ms/powershell" sh -c "command -v pwsh || command -v powershell"
      check "Windows SDK (makeappx, signtool)" "install the Windows 10/11 SDK (Visual Studio Installer)" \
        sh -c "ls '/c/Program Files (x86)/Windows Kits/10/bin' | grep -q '^10\\.'"
      rust_target x86_64-pc-windows-msvc ;;
    *) echo "  unknown target \"$1\" (web native macos ios android linux windows)"; missing=$((missing + 1)) ;;
  esac
}

common
for t in "${targets[@]}"; do target "$t"; done
echo
if [ "$missing" -eq 0 ]; then echo "ceangal doctor: ready for ${targets[*]}"; exit 0; fi
echo "ceangal doctor: $missing missing (above, each with how to get it)"
[ "$strict" -eq 1 ] && exit 1
exit 0
