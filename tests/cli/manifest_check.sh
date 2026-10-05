#!/usr/bin/env bash
# `ceangal.toml` checks (cli/src/check.almd): a manifest with one of each
# mistake gets each error and warning, by name; the reference apps get none.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
dir="$(mktemp -d)"; trap 'rm -rf "$dir"' EXIT
mkdir -p "$dir/src" && touch "$dir/src/main.almd"
cat > "$dir/ceangal.toml" <<TOML
[app]
id = "dev.example.my-app"
version = "1.0 beta"
build = 0
icon = "icon.svg"
icon_backgroud = "#123456"
icon_background = "blue"
network = "yes"
assets = ["nope"]
languages = ["english!"]

[framwork]
version = "0.2.0"

[framework]
path = "$root"
version = "0.2.0"
TOML
out="$("$root/tools/ceangal" info --app "$dir" 2>&1)" && { echo "FAIL: a broken ceangal.toml was accepted"; exit 1; }
fail=0
for want in \
  'unknown key [app] icon_backgroud (did you mean "icon_background"?)' \
  'unknown table [framwork] (did you mean "framework"?)' \
  '[framework] has both path and version' \
  '"english!" is not a language tag' \
  '[app] network must be true or false' \
  '[app] id "dev.example.my-app" must be reverse-DNS' \
  '[app] version "1.0 beta" must be' \
  '[app] build must be from 1' \
  '[app] icon_background "blue" must be a colour' \
  '[app] icon: icon.svg does not exist' \
  '[app] assets: nope does not exist'; do
  if grep -qF -- "$want" <<<"$out"; then echo "ok   $want"; else echo "FAIL missing: $want"; fail=1; fi
done
for app in apps/playground apps/todo tests/apps/services; do
  if "$root/tools/ceangal" info --app "$root/$app" 2>&1 | grep -q "ceangal.toml"; then
    echo "FAIL $app: unexpected findings"; "$root/tools/ceangal" info --app "$root/$app"; fail=1
  else echo "ok   $app is clean"; fi
done
[ $fail -eq 0 ] || { echo "$out"; exit 1; }
