// Any app's web build in a real (headless) Chrome: the page starts, draws,
// exposes its accessibility tree, and (with --click) answers a click.
//   node tests/e2e/smoke_web.mjs <web dir> [--click LABEL] [--expect TEXT] [--shot out.png]
// TEXT is looked for in the ARIA overlay's labels and values after the click.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "../lib/cdp.mjs";
import { serve } from "../lib/serve.mjs";

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const dir = args[0] && !args[0].startsWith("--") ? resolve(args[0]) : null;
if (!dir) { console.error("usage: smoke_web.mjs <web dir> [--click LABEL] [--expect TEXT] [--shot out.png]"); process.exit(2); }

const server = await serve(dir);
const page = await launch({ width: 480, height: 640 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (e) => page.eval(e);
async function waitFor(fn, what, ms = 30000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`); await sleep(100); }
}
const labels = () => ev(`[...document.querySelectorAll("[aria-label]")].filter((e) => e.tagName !== "CANVAS").map((e) => [e.getAttribute("aria-label"), e.getAttribute("aria-valuetext") ?? "", e.textContent ?? ""].join(" "))`);

let ok = false;
try {
  await page.goto(`${server.url}/index.html`);
  await waitFor(() => ev(`!!window.ceangal || getComputedStyle(document.getElementById("unsupported")).display !== "none"`), "the app starts");
  if (await ev(`getComputedStyle(document.getElementById("unsupported")).display !== "none"`)) throw new Error("the page says WebGPU is not available");
  const nodes = await waitFor(async () => { const l = await labels(); return l.length ? l : null; }, "accessibility nodes");
  console.log(`ok   started: ${nodes.length} accessibility nodes`);
  const click = opt("--click");
  if (click) {
    const r = await waitFor(() => ev(`(() => { const e = [...document.querySelectorAll("[aria-label]")].filter((e) => e.tagName !== "CANVAS" && e.getAttribute("aria-label") === ${JSON.stringify(click)}).at(-1); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`), `"${click}"`);
    for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
    console.log(`ok   clicked "${click}"`);
  }
  const expect = opt("--expect");
  if (expect) {
    await waitFor(async () => (await labels()).some((l) => l.includes(expect)), `"${expect}" on screen`, 10000);
    console.log(`ok   "${expect}" on screen`);
  }
  if (await ev(`getComputedStyle(document.getElementById("crashed")).display !== "none"`)) throw new Error("the app crashed");
  ok = true;
} catch (e) {
  console.log(`FAIL ${e.message}`);
  console.log(`     on screen: ${JSON.stringify(await labels().catch(() => []))}`);
} finally {
  const shot = opt("--shot");
  if (shot) writeFileSync(shot, await page.screenshot());
  await page.close();
  server.server.close();
}
process.exit(ok ? 0 : 1);
