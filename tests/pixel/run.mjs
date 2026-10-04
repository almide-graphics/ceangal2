// M0 exit test: the same app renders the same pixels on the web host
// (headless Chrome, WebGPU) and the native host (wgpu, headless).
//
//   node tests/pixel/run.mjs [--update]
//
// Builds apps/demo for both targets, renders each case on both hosts,
// compares them (max channel difference > 3 counts as a mismatch; a case
// fails above 0.5% mismatching pixels) and checks the native image against
// the committed golden in tests/pixel/golden/ to catch regressions.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../lib/cdp.mjs";
import { serve } from "../lib/serve.mjs";
import { compare, decodePng, diffImage, encodePng } from "../lib/png.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "out/pixel");
const golden = join(root, "tests/pixel/golden");
mkdirSync(out, { recursive: true });
mkdirSync(golden, { recursive: true });
const update = process.argv.includes("--update");
const almide = join(root, "tools/almide");
const exe = process.platform === "win32" ? ".exe" : "";

const APPS = {
  demo: {
    dir: "apps/demo",
    cases: [
      { name: "demo-initial", w: 800, h: 600, script: "" },
      { name: "demo-click", w: 800, h: 600, script: "click 650 140" },
      { name: "demo-hidpi", w: 400, h: 300, scale: 2, script: "click 140 140" },
    ],
  },
};

function build(app) {
  const dir = join(root, app.dir);
  const name = app.dir.split("/").pop();
  const wasm = join(out, `${name}.wasm`);
  const bin = join(out, `${name}${exe}`);
  if (!process.env.SKIP_BUILD) {
    execFileSync(almide, ["build", "src/main.almd", "--target", "wasm", "-o", wasm], { cwd: dir, stdio: "inherit" });
    execFileSync(almide, ["build", "src/main.almd", "-o", bin], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  }
  return { wasm, bin };
}

function renderNative(bin, c) {
  const png = join(out, `${c.name}.native.png`);
  execFileSync(bin, [], {
    env: { ...process.env, CEANGAL_HEADLESS: png, CEANGAL_SIZE: `${c.w}x${c.h}`, CEANGAL_SCALE: String(c.scale || 1), CEANGAL_SCRIPT: c.script, CEANGAL_ASSETS: join(root, "assets") },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return decodePng(readFileSync(png));
}

async function renderWeb(page, base, wasmPath, c) {
  const rel = wasmPath.slice(root.length);
  const assets = Object.fromEntries(["ui.ttf", "ui-semibold.ttf", "mono.ttf", "cjk.ttf"].map((f) => [`fonts/${f}`, `/assets/fonts/${f}`]));
  const url = `${base}/tests/pixel/page.html?wasm=${encodeURIComponent(rel)}&w=${c.w}&h=${c.h}&scale=${c.scale || 1}&script=${encodeURIComponent(c.script)}&assets=${encodeURIComponent(JSON.stringify(assets))}`;
  await page.goto(url);
  const r = await page.eval("window.__run()", 120000);
  const img = { width: r.width, height: r.height, rgba: new Uint8Array(Buffer.from(r.rgba, "base64")) };
  writeFileSync(join(out, `${c.name}.web.png`), encodePng(img));
  return img;
}

const { server, url } = await serve(root);
const chrome = await launch();
let failed = 0;
try {
  for (const app of Object.values(APPS)) {
    const { wasm, bin } = build(app);
    for (const c of app.cases) {
      const native = renderNative(bin, c);
      let web;
      try {
        web = await renderWeb(chrome, url, wasm, c);
      } catch (e) {
        console.log(chrome.logs.join("\n"));
        throw e;
      }
      const cmp = compare(native, web, 3);
      const ok = cmp.mismatch <= 0.005;
      if (!ok) writeFileSync(join(out, `${c.name}.diff.png`), encodePng(diffImage(native, web)));
      const g = join(golden, `${c.name}.png`);
      let goldenNote = "";
      if (update || !existsSync(g)) {
        writeFileSync(g, encodePng(native));
        goldenNote = " (golden written)";
      } else {
        const gc = compare(decodePng(readFileSync(g)), native, 3);
        if (gc.mismatch > 0.005) { failed++; goldenNote = ` GOLDEN MISMATCH ${(gc.mismatch * 100).toFixed(2)}%`; }
      }
      if (!ok) failed++;
      console.log(`${ok ? "ok  " : "FAIL"} ${c.name}: web vs native ${(cmp.mismatch * 100).toFixed(3)}% px differ, max diff ${cmp.maxDiff}${goldenNote}`);
    }
  }
} finally {
  await chrome.close();
  server.close();
}
process.exit(failed ? 1 : 0);
