// `ceangal test web`: an app's tests (tests/*.test) against its web build
// in headless Chrome. The steps and their meaning are the native runner's
// (ceangal/native/host.rs, `ceangal test native`): views are found by their
// accessible labels, as a screen reader and a user see them.
//   node tests/e2e/app_test.mjs <web dir> <file.test>… [--shots DIR] [--size WxH]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { launch } from "../lib/cdp.mjs";
import { serve } from "../lib/serve.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const shots = resolve(opt("--shots", "build/test"));
const [width, height] = opt("--size", "420x860").split("x").map(Number);
const positional = args.filter((a, i) => !a.startsWith("--") && !["--shots", "--size"].includes(args[i - 1]));
const [dir, ...files] = positional;
if (!dir || files.length === 0) { console.error("usage: app_test.mjs <web dir> <file.test>… [--shots DIR] [--size WxH]"); process.exit(2); }
mkdirSync(shots, { recursive: true });

const KEYS = { Enter: [13, "Enter"], Tab: [9, "Tab"], Backspace: [8, "Backspace"], Delete: [46, "Delete"], Escape: [27, "Escape"],
  Left: [37, "ArrowLeft"], Right: [39, "ArrowRight"], Up: [38, "ArrowUp"], Down: [40, "ArrowDown"], Home: [36, "Home"], End: [35, "End"],
  PageUp: [33, "PageUp"], PageDown: [34, "PageDown"], Space: [32, " "] };
const MODS = { Shift: 8, Ctrl: 2, Alt: 1, Cmd: 4, Meta: 4 }; // CDP's modifier bits

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = await serve(resolve(dir));
let failed = 0;

for (const file of files) {
  const page = await launch({ width, height });
  const ev = (e) => page.eval(e);
  const nodes = () => ev(`[...document.querySelectorAll("[data-ceangal-a11y] [aria-label]")].map((e) => { const r = e.getBoundingClientRect(); return { label: e.getAttribute("aria-label"), value: e.getAttribute("aria-valuetext") || "", x: r.left + r.width / 2, y: r.top + r.height / 2 }; })`).catch(() => []);
  const texts = async () => (await nodes()).map((n) => (n.value ? `${n.label} = ${n.value}` : n.label));
  const until = async (fn, ms = 5000) => { const t0 = Date.now(); for (;;) { if (await fn()) return true; if (Date.now() - t0 > ms) return false; await sleep(50); } };
  const shot = async (name) => writeFileSync(join(shots, name), await page.screenshot());
  const lines = readFileSync(file, "utf8").split("\n");
  let steps = 0, ok = true;
  try {
    await page.goto(`${server.url}/index.html`);
    if (!(await until(async () => (await nodes()).length > 0, 30000))) throw new Error("the app did not start");
    for (let i = 0; i < lines.length && ok; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith("#")) continue;
      const sp = line.indexOf(" ");
      const cmd = sp < 0 ? line : line.slice(0, sp);
      let arg = sp < 0 ? "" : line.slice(sp + 1).trim();
      if (arg.length >= 2 && arg.startsWith('"') && arg.endsWith('"')) arg = arg.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, "\n");
      const fail = async (msg) => { console.log(`FAIL ${file}:${i + 1}: ${line}\n     ${msg}\n     on screen: ${JSON.stringify(await texts())}`); ok = false; };
      if (cmd === "tap" || cmd === "context") {
        let n = null;
        await until(async () => (n = (await nodes()).findLast((x) => x.label === arg)));
        if (!n) { await fail(`no view labelled ${JSON.stringify(arg)}`); break; }
        // off the page: scroll it into view with the wheel, as a user would
        const [vw, vh] = await ev("[innerWidth, innerHeight]");
        for (let tries = 0; tries < 12 && (n.y < 8 || n.y > vh - 8); tries++) {
          await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: vw / 2, y: vh / 2, deltaX: 0, deltaY: n.y - vh / 2 });
          await sleep(120);
          n = (await nodes()).findLast((x) => x.label === arg) || n;
        }
        // context: a right-click
        const [button, down] = cmd === "tap" ? ["left", 1] : ["right", 2];
        for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: n.x, y: n.y, button, buttons: type === "mousePressed" ? down : 0, clickCount: 1 });
      } else if (cmd === "type") {
        await page.send("Input.insertText", { text: arg });
      } else if (cmd === "key") {
        const parts = arg.split("+");
        const k = KEYS[parts.at(-1)] || (parts.at(-1).length === 1 ? [parts.at(-1).toUpperCase().charCodeAt(0), parts.at(-1).toLowerCase()] : null);
        if (!k) { await fail(`unknown key ${JSON.stringify(arg)}`); break; }
        const modifiers = parts.slice(0, -1).reduce((m, p) => m | (MODS[p] || 0), 0);
        for (const type of ["rawKeyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: k[1], code: k[1], windowsVirtualKeyCode: k[0], modifiers });
      } else if (cmd === "see" || cmd === "not") {
        const want = cmd === "see";
        if (!(await until(async () => (await texts()).some((s) => s.includes(arg)) === want))) await fail(`${JSON.stringify(arg)} is ${want ? "not " : ""}on screen`);
      } else if (cmd === "wait") {
        await sleep(Number(arg) || 100);
      } else if (cmd === "shot") {
        await sleep(100);
        await shot(arg);
      } else {
        await fail(`unknown step ${JSON.stringify(cmd)} (tap, context, type, key, see, not, wait, shot)`);
      }
      if (ok) steps++;
      await sleep(30);
    }
    if (ok && await ev(`getComputedStyle(document.getElementById("crashed")).display !== "none"`)) { console.log(`FAIL ${file}: the app crashed`); ok = false; }
  } catch (e) {
    console.log(`FAIL ${file}: ${e.message}`);
    ok = false;
  } finally {
    await shot(basename(file, ".test") + (ok ? ".png" : "-fail.png")).catch(() => {});
    await page.close();
  }
  if (ok) console.log(`ok   ${file}: ${steps} steps`); else failed++;
}
server.server.close();
process.exit(failed ? 1 : 0);
