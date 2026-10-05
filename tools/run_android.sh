#!/usr/bin/env bash
# `ceangal run android`: build the app for the connected device or running
# emulator's ABI, install and launch it, then follow its log.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/tools/app_env.sh"
: "${ANDROID_HOME:=${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
adb="$ANDROID_HOME/platform-tools/adb"
"$adb" get-state >/dev/null 2>&1 || { echo "no Android device or emulator: start one (Android Studio → Device Manager)" >&2; exit 1; }
abi="$("$adb" shell getprop ro.product.cpu.abi | tr -d '\r')"
"$root/tools/build_android.sh" "$abi"
"$adb" install -r "$APP_OUT/android/$APP_KEY.apk"
"$adb" shell am start -n "$APP_ID/android.app.NativeActivity"
pid=""
for _ in $(seq 50); do pid="$("$adb" shell pidof "$APP_ID" | tr -d '\r' || true)"; [ -n "$pid" ] && break; sleep 0.2; done
[ -n "$pid" ] || { echo "$APP_ID did not start (adb logcat shows why)" >&2; exit 1; }
exec "$adb" logcat --pid "$pid"
