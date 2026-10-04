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

// Shortcut modifier for scripts: ctrl|meta, so it reads as the shortcut on
// every platform (Apple checks meta, the rest ctrl).
const SC = 10;

const APPS = {
  editor: {
    dir: "apps/editor",
    cases: [
      { name: "editor-typing", w: 900, h: 560, script: "click 400 300; key 15 0; text  // 追記した; key 1 0; text let x = [1, 2]" },
      { name: "editor-ime", w: 900, h: 560, script: "click 400 300; key 15 0; text  // ; preedit にほんご" },
      { name: "editor-select-undo", w: 900, h: 560, script: `click 300 188; key 11 1; key 11 1; key 11 1; text Z; key 24 ${SC}; key 13 1` },
      { name: "editor-10k-scrolled", w: 900, h: 560, script: "key 44 0; wheel 450 300 0 120000", bench: "bench 120 37" },
    ],
  },
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
    execFileSync(almide, ["build", "src/main.almd", "--release", "-o", bin], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  }
  return { wasm, bin };
}

function renderNative(bin, c) {
  const png = join(out, `${c.name}.native.png`);
  const script = c.bench ? `${c.script}; ${c.bench}` : c.script;
  const stdout = execFileSync(bin, [], {
    env: { ...process.env, CEANGAL_HEADLESS: png, CEANGAL_SIZE: `${c.w}x${c.h}`, CEANGAL_SCALE: String(c.scale || 1), CEANGAL_SCRIPT: script, CEANGAL_ASSETS: join(root, "assets") },
    stdio: ["ignore", "pipe", "inherit"],
  }).toString();
  const m = stdout.match(/bench: frames=(\d+) avg_ms=([\d.]+) p95_ms=([\d.]+) max_ms=([\d.]+)/);
  const img = decodePng(readFileSync(png));
  if (m) img.bench = { frames: +m[1], avg_ms: +m[2], p95_ms: +m[3], max_ms: +m[4] };
  return img;
}

async function renderWeb(page, base, wasmPath, c) {
  const rel = wasmPath.slice(root.length);
  const assets = Object.fromEntries(["ui.ttf", "ui-semibold.ttf", "mono.ttf", "cjk.ttf"].map((f) => [`fonts/${f}`, `/assets/fonts/${f}`]));
  const script = c.bench ? `${c.script}; ${c.bench}` : c.script;
  const url = `${base}/tests/pixel/page.html?wasm=${encodeURIComponent(rel)}&w=${c.w}&h=${c.h}&scale=${c.scale || 1}&script=${encodeURIComponent(script)}&assets=${encodeURIComponent(JSON.stringify(assets))}`;
  await page.goto(url);
  const r = await page.eval("window.__run()", 240000);
  const img = { width: r.width, height: r.height, rgba: new Uint8Array(Buffer.from(r.rgba, "base64")), bench: r.bench };
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
      // 60 fps budget: p95 frame (event + layout + paint + GPU) under 16.7 ms.
      for (const [host, img] of [["native", native], ["web", web]]) {
        if (!img.bench) continue;
        const b = img.bench;
        const fast = b.p95_ms < 16.7;
        // Hosted CI runners give the native host a paravirtual GPU (several
        // times slower than a real one): there the native number is reported,
        // not enforced. Local runs enforce both.
        const enforced = !(process.env.CI && host === "native");
        if (!fast && enforced) failed++;
        console.log(`${fast ? "ok  " : enforced ? "FAIL" : "warn"} ${c.name} ${host} bench: ${b.frames} frames, avg ${b.avg_ms.toFixed(2)} ms, p95 ${b.p95_ms.toFixed(2)} ms, max ${b.max_ms.toFixed(2)} ms`);
      }
    }
  }
} finally {
  await chrome.close();
  server.close();
}
process.exit(failed ? 1 : 0);
