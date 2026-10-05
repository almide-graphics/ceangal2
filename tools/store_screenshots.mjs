// Store screenshots, rendered by the native playground in headless mode at
// each store's required size (the app as it ships: same code, same fonts).
//
//   node tools/store_screenshots.mjs        (after tools/build_native.sh)
//   → store/playground/screenshots/<device>/<n>-<scene>.png
//
// Scenes are launch URLs (?example=…&autorun=1&theme=…), so no clicks are
// scripted and the shots stay stable.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(root, process.platform === "win32" ? "out/native/playground.exe" : "out/native/playground");
if (!existsSync(bin)) throw new Error(`build the native playground first (tools/build_native.sh): ${bin}`);
const sep = process.platform === "win32" ? ";" : ":";

// logical size × scale = the store's pixel size
const devices = {
  "iphone-6.9": { w: 440, h: 956, scale: 3 },     // 1320 × 2868 (App Store, required)
  "ipad-13": { w: 1032, h: 1376, scale: 2 },      // 2064 × 2752 (App Store, iPad)
  "mac": { w: 1440, h: 900, scale: 2 },           // 2880 × 1800 (Mac App Store)
  "android-phone": { w: 360, h: 640, scale: 3 },  // 1080 × 1920 (Google Play, 9:16)
  "android-tablet": { w: 1280, h: 800, scale: 2 },// 2560 × 1600 (Google Play, 10")
  "windows": { w: 1280, h: 720, scale: 1.5 },     // 1920 × 1080 (Microsoft Store)
  "linux": { w: 1280, h: 800, scale: 1 },         // 1280 × 800 (Flathub / AppStream)
};

const scenes = [
  { name: "fireworks", url: "?example=hanabi&autorun=1&theme=dark" },
  { name: "markdown", url: "?example=mini-markdown&autorun=1&theme=light" },
  { name: "todo-gui", url: "?example=todo&autorun=1&theme=dark" },
  { name: "maze", url: "?example=maze&autorun=1&theme=light" },
  { name: "code", url: "?example=pattern-matching&theme=dark" },
];

let failed = 0;
for (const [device, d] of Object.entries(devices)) {
  const dir = join(root, "store/playground/screenshots", device);
  mkdirSync(dir, { recursive: true });
  scenes.forEach((s, i) => {
    const out = join(dir, `${i + 1}-${s.name}.png`);
    const data = mkdtempSync(join(tmpdir(), "shots-"));
    const r = spawnSync(bin, [], {
      env: {
        ...process.env,
        CEANGAL_HEADLESS: out,
        CEANGAL_SIZE: `${d.w}x${d.h}`,
        CEANGAL_SCALE: String(d.scale),
        CEANGAL_DATA_DIR: data,
        CEANGAL_LAUNCH: `https://play.almide.dev/${s.url}`,
        // compile + run, then let a GUI program draw a few frames
        CEANGAL_SCRIPT: "wait 30000; wait 5000; frames 6",
        CEANGAL_ASSETS: [join(root, "apps/playground/assets"), join(root, "assets")].join(sep),
      },
      encoding: "utf8",
      timeout: 180000,
    });
    rmSync(data, { recursive: true, force: true });
    if (r.status !== 0) { failed++; console.log(`FAIL ${device}/${s.name}: ${r.error || r.stderr.slice(-400)}`); }
    else console.log(`ok   ${device}/${i + 1}-${s.name}.png (${Math.round(d.w * d.scale)}×${Math.round(d.h * d.scale)})`);
  });
}
process.exit(failed ? 1 : 0);
