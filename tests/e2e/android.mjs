// Android E2E on an emulator or device: installs out/android/<app>.apk, drives
// it with `adb shell input` and reads what it shows from the a11y tree the app
// logs when `debug.ceangal.a11y` is 1 (ceangal/native/a11y.rs).
//
//   node tests/e2e/android.mjs [todo|playground]…   (default: both that exist)
//
// ANDROID_SERIAL picks the device; screenshots go to out/e2e/android-*.png.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { EDIT_TODO_KEYS, autorunLink, programs, reference } from "../lib/fixtures.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), "Library/Android/sdk");
const adbPath = existsSync(join(sdk, "platform-tools/adb")) ? join(sdk, "platform-tools/adb") : "adb";
const shots = join(root, "out/e2e");
mkdirSync(shots, { recursive: true });

const adb = (...args) => execFileSync(adbPath, args, { encoding: "utf8", maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
async function step(name, f) {
  try { await f(); console.log(`ok   ${name}`); }
  catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message}`);
    // evidence for CI: the screen and the app's log
    const slug = name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
    try { shot(`fail-${slug}`); } catch {}
    try { writeFileSync(join(shots, `android-fail-${slug}.log`), adb("logcat", "-d", "-t", "400")); } catch {}
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

/** The last complete tree the app logged: { scale, nodes: [{role,x,y,w,h,flags,label,value}] }. */
let pkgNow = "";
const pid = () => { try { return adb("shell", "pidof", pkgNow).trim().split(/\s+/)[0]; } catch { return ""; } };
const logcat = (...tags) => { const p = pid(); return p ? adb("logcat", "-d", "-v", "raw", `--pid=${p}`, "-s", ...tags) : ""; };

function tree() {
  const lines = logcat("ceangal:I").split("\n").map((l) => l.replace(/\r$/, ""));
  const end = lines.lastIndexOf("a11y-end");
  if (end < 0) return null;
  let begin = end;
  while (begin >= 0 && !lines[begin].startsWith("a11y-begin")) begin--;
  if (begin < 0) return null;
  const scale = +lines[begin].split(" ")[1];
  const nodes = lines.slice(begin + 1, end).map((l) => {
    const [role, x, y, w, h, flags, label, value] = l.split("\t");
    return { role: +role, x: +x, y: +y, w: +w, h: +h, flags: +flags, label, value };
  });
  return { scale, nodes };
}

function panics() {
  return logcat("ceangal:I", "RustPanic:E").split("\n").filter((l) => /panic/i.test(l));
}

/** Wait until `pred(tree)` holds; returns that tree. */
async function until(pred, what, ms = 20000) {
  const t0 = Date.now();
  let t = null;
  while (Date.now() - t0 < ms) {
    t = tree();
    if (t && pred(t)) return t;
    const p = panics();
    if (p.length) throw new Error(`app panicked: ${p.join(" | ")}`);
    await sleep(400);
  }
  throw new Error(`timed out waiting for ${what}; labels: ${t ? t.nodes.map((n) => n.label).filter(Boolean).join(" | ") : "(no tree)"}`);
}

/** The user program's tree (labels + rects relative to its window). */
function guiTree() {
  const lines = logcat("ceangal:I").split("\n").map((l) => l.replace(/\r$/, ""));
  const end = lines.lastIndexOf("gui-a11y-end");
  if (end < 0) return [];
  let begin = end;
  while (begin >= 0 && lines[begin] !== "gui-a11y-begin") begin--;
  return lines.slice(begin + 1, end).map((l) => { const [label, x, y, w, h] = l.split("\t"); return { label, x: +x, y: +y, w: +w, h: +h }; });
}

async function untilGui(pred, what, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const g = guiTree();
    if (pred(g)) return g;
    await sleep(400);
  }
  throw new Error(`timed out waiting for ${what}; program labels: ${guiTree().map((n) => n.label).join(" | ")}`);
}

async function keyboardShown(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (/mInputShown=true/.test(adb("shell", "dumpsys", "input_method"))) { await sleep(500); return; }
    await sleep(200);
  }
  throw new Error("the soft keyboard did not come up");
}

/** Tap a node of the user program: its rect is relative to the program window. */
// A slow device lays out over several frames (insets, the soft keyboard):
// read the box until it stops moving before tapping it.
async function settled(read, what) {
  let last = "";
  for (let i = 0; i < 20; i++) {
    const r = read();
    const k = JSON.stringify(r);
    if (r && k === last) return r;
    last = k;
    await sleep(400);
  }
  throw new Error(`${what} kept moving`);
}

async function tapGui(label) {
  // on a small screen the soft keyboard can leave the node below the
  // program's visible window: put the keyboard away first, as a user would
  const first = guiTree().find((g) => g.label === label), w0 = tree() && node(tree(), "Program window");
  if (first && w0 && first.y + first.h > w0.h) { adb("shell", "input", "keyevent", "4"); await sleep(800); }
  const { t, win, n } = await settled(() => {
    const t = tree();
    const win = t && node(t, "Program window");
    const n = guiTree().find((g) => g.label === label);
    return win && n ? { t, win, n } : null;
  }, `program node "${label}"`);
  adb("shell", "input", "tap", String(Math.round((win.x + n.x + n.w / 2) * t.scale)), String(Math.round((win.y + n.y + n.h / 2) * t.scale)));
  await sleep(500);
}

const has = (label) => (t) => t.nodes.some((n) => n.label === label);
const node = (t, label) => t.nodes.find((n) => n.label === label);

async function tap(t0, label) {
  assert(node(t0, label), `no "${label}"`);
  const t = await settled(() => { const t = tree(); const n = t && node(t, label); return n ? { scale: t.scale, n } : null; }, `"${label}"`);
  const n = t.n;
  const s = t.scale;
  adb("shell", "input", "tap", String(Math.round((n.x + n.w / 2) * s)), String(Math.round((n.y + n.h / 2) * s)));
  await sleep(500);
}

function shot(name) {
  const png = execFileSync(adbPath, ["exec-out", "screencap", "-p"], { maxBuffer: 64 << 20 });
  writeFileSync(join(shots, `android-${name}.png`), png);
}

// Stop the app for real (force-stop returns before the process is gone; a
// start in that window is delivered to the dying instance), then start it.
async function launch(pkg, { clear = true, data = null } = {}) {
  adb("shell", "am", "force-stop", pkg);
  if (clear) adb("shell", "pm", "clear", pkg);
  for (let i = 0; i < 50 && pid(); i++) await sleep(100);
  adb("logcat", "-c");
  adb("shell", "am", "start", "-n", `${pkg}/android.app.NativeActivity`, ...(data ? ["-d", data] : []));
  for (let i = 0; i < 100 && !pid(); i++) await sleep(100);
}

adb("shell", "setprop", "debug.ceangal.a11y", "1");
adb("shell", "setprop", "debug.ceangal.gui_a11y", "1");
adb("shell", "setprop", "debug.ceangal.run_log", "1");
// A fresh emulator image may still count as "in setup": then Home is
// skipped and the background / foreground step never leaves the app.
adb("shell", "settings", "put", "secure", "user_setup_complete", "1");
adb("shell", "settings", "put", "global", "device_provisioned", "1");
const apps = process.argv.slice(2).length ? process.argv.slice(2) : ["todo", "playground"].filter((a) => existsSync(join(root, `out/android/${a}.apk`)));

for (const app of apps) {
  const apk = join(root, `out/android/${app}.apk`);
  const pkg = app === "todo" ? "dev.almide.todo" : "dev.almide.playground";
  pkgNow = pkg;
  console.log(`# ${app} (${apk})`);
  adb("install", "-r", apk);

  if (app === "todo") {
    await step("todo: starts and renders the list", async () => {
      await launch(pkg);
      await until(has("New task"), "the New task field");
      shot("todo-start");
    });
    await step("todo: type a task with the soft keyboard, Enter adds it", async () => {
      await tap(tree(), "New task");
      // type only once the keyboard is up and bound to the field: text sent
      // earlier is lost in part (CI once got "ilk")
      await keyboardShown();
      adb("shell", "input", "text", "Buy%smilk");
      await sleep(300);
      adb("shell", "input", "keyevent", "66");
      await until((t) => has("Buy milk")(t) && has("2 tasks left")(t), "the new task");
      shot("todo-added");
    });
    await step("todo: tap toggles, remove deletes", async () => {
      await tap(tree(), "Buy milk");
      await until(has("1 task left"), "1 task left");
      await tap(tree(), "Remove Buy milk");
      await until((t) => !has("Buy milk")(t), "the task removed");
    });
    await step("todo: survives background / foreground (surface recreated)", async () => {
      adb("shell", "input", "keyevent", "3"); // HOME
      await sleep(1500);
      adb("logcat", "-c");
      adb("shell", "am", "start", "-n", `${pkg}/android.app.NativeActivity`);
      await until(has("New task"), "the app after resume");
      assert(panics().length === 0, "panic after resume");
      shot("todo-resumed");
    });
    await step("todo: content stays inside the safe area", async () => {
      const t = tree();
      const top = Math.min(...t.nodes.filter((n) => n.label).map((n) => n.y));
      assert(top * t.scale >= 24, `content starts at y=${top} (under the status bar?)`);
    });
  }

  if (app === "playground") {
    await step("playground: starts with the editor", async () => {
      await launch(pkg);
      await until(has("Run"), "the Run button", 30000);
      shot("playground-start");
    });
    await step("playground: Run compiles and runs on the device", async () => {
      await tap(tree(), "Run");
      // the phone layout has no status line (the action bar replaces it):
      // the program's output in the Output pane is the signal
      await until((t) => t.nodes.some((n) => n.label === "Features"), "the program's output", 60000);
      shot("playground-run");
    });
    await step("playground: the Examples menu scrolls with a finger", async () => {
      await tap(tree(), "Examples");
      const t = await until(has("Examples menu"), "the Examples menu");
      const m = node(t, "Examples menu");
      const s = t.scale;
      const cx = Math.round((m.x + m.w / 2) * s);
      // swipe up inside the menu until "Todo app" is fully in it
      for (let i = 0; i < 6; i++) {
        const now = tree(), item = node(now, "Todo app"), box = node(now, "Examples menu");
        if (item && box && item.y + item.h <= box.y + box.h && item.y >= box.y) break;
        adb("shell", "input", "swipe", String(cx), String(Math.round((m.y + m.h * 0.8) * s)), String(cx), String(Math.round((m.y + m.h * 0.2) * s)), "250");
        await sleep(900);
      }
      shot("playground-examples");
      await tap(tree(), "Todo app");
      await until((t) => (node(t, "Code editor")?.value || "").includes("ceangal"), "the Todo example in the editor");
    });

    await step("playground: the Todo example is edited with the key bar, runs as a window and takes taps", async () => {
      await launch(pkg, { clear: false, data: "https://play.almide.dev/?example=todo" });
      const t0 = await until(has("Code editor"), "the playground", 30000);
      // the edit: a tap at the top of the source raises the keyboard and
      // the key bar; six lines down (the first task); a new task typed in
      // front of it, its symbols from the key bar
      const ed = node(t0, "Code editor");
      adb("shell", "input", "tap", String(Math.round((ed.x + 4) * t0.scale)), String(Math.round((ed.y + 16) * t0.scale)));
      await until(has("Key bar"), "the key bar over the keyboard");
      shot("playground-keybar");
      for (let i = 0; i < 6; i++) await tap(tree(), "Down arrow");
      for (const [how, s] of EDIT_TODO_KEYS) {
        if (how === "bar") await tap(tree(), `Insert ${s}`);
        else { adb("shell", "input", "text", s.replace(/ /g, "%s")); await sleep(300); }
      }
      await until((t) => (node(t, "Code editor")?.value || "").includes(EDIT_TODO_KEYS.map((k) => k[1]).join("").trim()), "the edit in the editor");
      adb("shell", "input", "keyevent", "4");   // the keyboard away: the action bar is back
      await until(has("Run"), "the Run button");
      await tap(tree(), "Run");
      await until(has("Program window"), "the program window", 60000);
      await untilGui((g) => g.some((n) => n.label === "Edited") && g.some((n) => n.label === "2 tasks left"), "the edited program");
      await tapGui("New task");
      adb("shell", "input", "text", "Buy%smilk");
      await sleep(300);
      adb("shell", "input", "keyevent", "66");
      // the edited example starts with two tasks open: Buy milk makes three, done again two
      await untilGui((g) => g.some((n) => n.label === "Remove Buy milk") && g.some((n) => n.label === "3 tasks left"), "the program to add the task");
      await tapGui("Buy milk");
      await untilGui((g) => g.some((n) => n.label === "2 tasks left"), "the program to toggle the task");
      shot("playground-gui");
      await tap(tree(), "Stop");
      await until((t) => !has("Program window")(t), "Stop");
    });

    await step("playground: the fixtures and examples run on the device, matching the CLI", async () => {
      const bad = [];
      for (const p of programs()) {
        await launch(pkg, { clear: false, data: autorunLink(p) });
        const t0 = Date.now();
        let end = null, lines = [];
        while (Date.now() - t0 < 90000) {
          lines = logcat("ceangal:I").split("\n").map((l) => l.replace(/\r$/, ""));
          end = lines.find((l) => l.startsWith("run-end "));
          if (end) break;
          const pn = panics();
          if (pn.length) throw new Error(`${p.id}: app panicked: ${pn.join(" | ")}`);
          await sleep(300);
        }
        if (!end) { bad.push(`${p.id}: no result`); continue; }
        const [, status, hex] = end.split(" ");
        const body = Buffer.from(hex || "", "hex").toString("utf8");
        if (status !== "200" || !/"exitCode":0\b/.test(body)) { bad.push(`${p.id}: ${status} ${body.slice(0, 200)}`); continue; }
        const out = Buffer.concat(lines.filter((l) => l.startsWith("run-out ")).map((l) => Buffer.from(l.slice(8), "hex"))).toString("utf8");
        const want = reference(p);
        if (want !== null && out.trimEnd() !== want) bad.push(`${p.id}: drift`);
      }
      assert(bad.length === 0, bad.join("; "));
    });
  }
}

adb("shell", "setprop", "debug.ceangal.a11y", "0");
adb("shell", "setprop", "debug.ceangal.gui_a11y", "0");
adb("shell", "setprop", "debug.ceangal.run_log", "0");
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
