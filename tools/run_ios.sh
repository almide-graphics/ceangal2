#!/usr/bin/env bash
# `ceangal run ios`: build the app for the simulator, boot one (IOS_SIM,
# default the first available iPhone), install and launch it.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/tools/app_env.sh"
"$root/tools/package_ios.sh" sim
app="$APP_OUT/ios/$APP_KEY/build/sim/$APP_KEY.app"
sim="${IOS_SIM:-$(xcrun simctl list devices available -j | python3 -c '
import json, sys
devs = [d for rt, ds in json.load(sys.stdin)["devices"].items() if "iOS" in rt for d in ds]
booted = [d for d in devs if d["state"] == "Booted"]
phones = [d for d in devs if d["name"].startswith("iPhone")]
print((booted or phones or devs)[0]["udid"])')}"
xcrun simctl boot "$sim" 2>/dev/null || true
open -a Simulator
xcrun simctl install "$sim" "$app"
xcrun simctl launch "$sim" "$APP_ID"
