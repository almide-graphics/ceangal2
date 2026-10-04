// The deployed page itself, in a real (headless) Chrome window: dist/web/
// index.html with its WebGPU canvas, real DOM input (CDP mouse / keyboard),
// and the ARIA overlay as the only way in — exactly what a user or a screen
// reader gets. Run against a local server, or `--url https://…` for Pages.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../lib/cdp.mjs";
import { serve } from "../lib/serve.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "out/e2e");
mkdirSync(out, { recursive: true });
const remote = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : null;
if (!remote && !process.env.SKIP_BUILD) execFileSync(join(root, "tools/build_web.sh"), { stdio: "inherit", env: { ...process.env, SKIP_COMPILER: process.env.SKIP_COMPILER ?? "1" } });

const local = remote ? null : await serve(root);
const base = remote || `${local.url}/dist/web/`;
const page = await launch({ width: 1280, height: 800 });
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (e, ms) => page.eval(e, ms);
function assert(c, m) { if (!c) throw new Error(m); }
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); console.log(`ok   ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}
// ARIA overlay lookups (the playground's own nodes and a running program's).
const labelRect = (label) => ev(`(() => { const els = [...document.querySelectorAll('[aria-label=${JSON.stringify(JSON.stringify(label)).slice(1, -1)}]')].filter((e) => e.tagName !== "CANVAS"); const e = els.at(-1); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, value: e.getAttribute("aria-valuetext") }; })()`);
async function waitFor(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`); await sleep(100); }
}
async function click(label) {
  const r = await waitFor(() => labelRect(label), 15000, `"${label}" on screen`);
  for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
}
const key = async (k, code, vk, modifiers = 0) => { for (const type of ["keyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
const textOf = async () => ev(`[...document.querySelectorAll('[data-ceangal-a11y] [role=note]')].map((e) => e.getAttribute("aria-label"))`);

try {
  await step("the page boots on WebGPU", async () => {
    await page.goto(`${base}index.html`);
    await waitFor(() => labelRect("Run"), 120000, "Run button");
    assert(await ev(`!!document.querySelector("canvas#app")`), "no app canvas");
    assert(await ev(`getComputedStyle(document.getElementById("unsupported")).display === "none"`), "unsupported message shown");
    writeFileSync(join(out, "page-boot.png"), await page.screenshot());
  });

  await step("type a program and run it with real keys", async () => {
    await click("Code editor");
    await key("a", "KeyA", 65, process.platform === "darwin" ? 4 : 2);   // select all (Cmd on mac, Ctrl elsewhere)
    await page.send("Input.insertText", { text: 'effect fn main() -> Unit = println("real page: " + int.to_string(6 * 7))\n' });
    await key("Enter", "Enter", 13, process.platform === "darwin" ? 4 : 2);   // Cmd/Ctrl+Enter runs
    await waitFor(async () => (await textOf()).includes("Exited 0"), 60000, "Exited 0");
    // the a11y value of the output refreshes at most every 250 ms: wait for it
    await waitFor(async () => ((await labelRect("Program output"))?.value || "").includes("real page: 42"), 5000, "output in the a11y tree");
    writeFileSync(join(out, "page-run.png"), await page.screenshot());
  });

  await step("the Todo example runs as a window over the Visual pane", async () => {
    await page.goto(`${base}index.html?example=todo`);
    await click("Run");
    await waitFor(() => labelRect("New task"), 120000, "program window");
    await click("New task");
    await page.send("Input.insertText", { text: "Ship it" });
    await key("Enter", "Enter", 13);
    await waitFor(() => labelRect("Ship it"), 20000, "new task");
    await click("Ship it");
    await waitFor(() => labelRect("1 task left"), 20000, "toggled");
    writeFileSync(join(out, "page-gui.png"), await page.screenshot());
    await click("Stop");
    await waitFor(async () => (await ev(`document.querySelectorAll("canvas").length`)) === 1, 20000, "program window closed");
  });
} finally {
  if (failed) console.log(page.logs.slice(-30).join("\n"));
  await page.close();
  local?.server.close();
}
process.exit(failed ? 1 : 0);
