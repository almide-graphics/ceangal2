#!/usr/bin/env python3
"""The Flatpak manifest, desktop entry and metainfo for build_flatpak.sh.

    flatpak_files.py <stage/linux> <manifest out> <almide version>

Each file the app keeps in <store>/linux (already staged) wins; the others
are written from the app's settings (APP_* in the environment).
"""
import html
import os
import shutil
import sys
from datetime import date

linux, manifest_out, almide = sys.argv[1:]
e = os.environ
app_id, key, name = e["APP_LINUX_ID"], e["APP_KEY"], e["APP_NAME"]
summary = e.get("APP_DESCRIPTION") or name
publisher = e.get("APP_PUBLISHER") or name
exe = f"ceangal-{key}" if key == "app" else key
x = html.escape


def write(path, text, keep=None):
    if keep and os.path.exists(keep):
        shutil.copy(keep, path)
        return
    if path == manifest_out or not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {os.path.basename(path)} from ceangal.toml")


write(os.path.join(linux, f"{app_id}.desktop"), f"""[Desktop Entry]
Type=Application
Name={name}
Comment={summary}
Exec={exe}
Icon={app_id}
Terminal=false
Categories=Utility;
StartupWMClass={app_id}
""")

write(os.path.join(linux, f"{app_id}.metainfo.xml"), f"""<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>{x(app_id)}</id>
  <metadata_license>CC0-1.0</metadata_license>
  <name>{x(name)}</name>
  <summary>{x(summary)}</summary>
  <developer id="{x(app_id.rsplit('.', 1)[0])}">
    <name>{x(publisher)}</name>
  </developer>
  <description>
    <p>{x(summary)}</p>
  </description>
  <launchable type="desktop-id">{x(app_id)}.desktop</launchable>
  <content_rating type="oars-1.1"/>
  <supports>
    <control>keyboard</control>
    <control>pointing</control>
  </supports>
  <releases>
    <release version="{x(e['APP_VERSION'])}" date="{date.today().isoformat()}"/>
  </releases>
</component>
""")

finish = ["--share=ipc", "--socket=wayland", "--socket=fallback-x11", "--device=dri",
          "--talk-name=org.freedesktop.secrets", f"--env=CEANGAL_ASSETS=/app/share/{exe}/assets"]
if e.get("APP_NETWORK") == "1":
    finish.insert(4, "--share=network")
fa = "\n".join(f"  - {a}" for a in finish)
write(manifest_out, keep=os.path.join(linux, f"{app_id}.yml"), text=f"""# Written by tools/build_flatpak.sh: the exported Rust project (src/), the
# vendored crates (cargo-sources.json) and the assets are staged next to it,
# and the build itself is offline.
id: {app_id}
runtime: org.freedesktop.Platform
runtime-version: '26.08'
sdk: org.freedesktop.Sdk
sdk-extensions:
  - org.freedesktop.Sdk.Extension.rust-stable
command: {exe}
finish-args:
{fa}
build-options:
  append-path: /usr/lib/sdk/rust-stable/bin
  env:
    CARGO_HOME: /run/build/{exe}/cargo
    CARGO_NET_OFFLINE: 'true'
    CEANGAL_APP_ID: {app_id}
modules:
  - name: {exe}
    buildsystem: simple
    build-commands:
      - cargo --offline build --release --manifest-path src/app/Cargo.toml
      - install -Dm755 src/app/target/release/almide-out /app/bin/{exe}
      - mkdir -p /app/share/{exe}/assets
      - cp -R assets/. /app/share/{exe}/assets/
      - install -Dm644 linux/{app_id}.desktop /app/share/applications/{app_id}.desktop
      - install -Dm644 linux/{app_id}.metainfo.xml /app/share/metainfo/{app_id}.metainfo.xml
      - for s in 64 128 256 512; do install -Dm644 icons/${{s}}x${{s}}.png /app/share/icons/hicolor/${{s}}x${{s}}/apps/{app_id}.png; done
    sources:
      - type: dir
        path: stage
      # almide's crates read ../../{{stdlib,runtime}} from their build scripts
      # (almide/almide#3361): unpack the matching source tree where
      # vendor/<crate>/../.. lands.
      - type: archive
        url: https://github.com/almide/almide/archive/refs/tags/v{almide}.tar.gz
        sha256: {e['ALMIDE_SRC_SHA256']}
        dest: cargo
      - cargo-sources.json
""")
