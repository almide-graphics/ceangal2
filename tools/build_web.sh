#!/usr/bin/env bash
# Assemble the app for the web into $APP_WEB_OUT (`[web] out`, default
# <build out>/web; the playground's is dist/web, what GitHub Pages serves). The app: `ceangal build web`, else
# $CEANGAL_APP (default apps/playground).
#
#   index.html, boot.js, manifest.webmanifest   tools/templates/web, filled in
#   <key>.wasm                                  the app
#   host.js, … vendor/                          the web host (hosts/web)
#   assets/ + assets.json                       APP_ASSETS merged
#   favicon, icons                              $APP_STORE/web
#   privacy.html                                $APP_STORE/privacy-policy.md
# then `[web] boot` replaces boot.js, `[web] files` are copied over the top
# and `[web] prebuild` runs with WEB_OUT set.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
source "$root/tools/app_env.sh"
out="${WEB_OUT:-$APP_WEB_OUT}"
app_icons

rm -rf "$out"
mkdir -p "$out"
build="$(app_build_dir web)"
(cd "$build" && "$root/tools/almide" build "$APP_ENTRY" --target wasm -o "$out/$APP_KEY.wasm")
node "$root/tests/wasm_stubs.mjs" "$out/$APP_KEY.wasm"

fill() { # template → stdout, the app's settings in place of __X__
  python3 - "$1" <<'PY'
import html, json, os, sys
e = os.environ
desc = e.get("APP_DESCRIPTION") or e["APP_NAME"]
text = open(sys.argv[1], encoding="utf-8").read()
js = sys.argv[1].endswith((".js", ".webmanifest"))
q = (lambda s: json.dumps(s)[1:-1]) if js else (lambda s: html.escape(s))
for k, v in {"NAME": e["APP_NAME"], "DESCRIPTION": desc, "BG": e["APP_ICON_BG"], "KEY": e["APP_KEY"], "ID": e["APP_ID"]}.items():
    text = text.replace(f"__{k}__", q(v))
sys.stdout.write(text)
PY
}
for f in index.html boot.js manifest.webmanifest; do fill "$root/tools/templates/web/$f" > "$out/$f"; done
cp "$root"/hosts/web/*.js "$out/"
cp -R "$root/hosts/web/vendor" "$out/vendor"
app_copy_assets "$out/assets"
(cd "$out/assets" && find . -type f | sed 's#^\./##' | LC_ALL=C sort | python3 -c 'import json,sys; print(json.dumps([l.strip() for l in sys.stdin]))') > "$out/assets.json"
cp -R "$APP_STORE/web/." "$out/"
if [ -f "$APP_STORE/privacy-policy.md" ]; then
  python3 "$root/tools/md_page.py" "$APP_STORE/privacy-policy.md" "$out/privacy.html" "$APP_NAME — Privacy Policy"
fi

[ -n "$APP_WEB_BOOT" ] && cp "$APP_WEB_BOOT" "$out/boot.js"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ -d "$f" ]; then cp -R "$f/." "$out/"; else cp "$f" "$out/"; fi
done <<<"$APP_WEB_FILES"
[ -n "$APP_WEB_PREBUILD" ] && WEB_OUT="$out" bash "$APP_WEB_PREBUILD"
touch "$out/.nojekyll"
echo "$out: $(du -sh "$out" | cut -f1)"
