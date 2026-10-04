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
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
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

/** Tap a node of the user program: its rect is relative to the program window. */
async function tapGui(label) {
  const t = tree();
  const win = node(t, "Program window");
  const n = guiTree().find((g) => g.label === label);
  assert(win && n, `no program node "${label}"`);
  adb("shell", "input", "tap", String(Math.round((win.x + n.x + n.w / 2) * t.scale)), String(Math.round((win.y + n.y + n.h / 2) * t.scale)));
  await sleep(500);
}

const has = (label) => (t) => t.nodes.some((n) => n.label === label);
const node = (t, label) => t.nodes.find((n) => n.label === label);

async function tap(t, label) {
  const n = node(t, label);
  assert(n, `no "${label}"`);
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
    await step("playground: the Todo example runs as a window and takes taps", async () => {
      await launch(pkg, { clear: false, data: "https://play.almide.dev/?example=todo" });
      await until(has("Run"), "the playground", 30000);
      await tap(tree(), "Run");
      await until(has("Program window"), "the program window", 60000);
      await untilGui((g) => g.some((n) => n.label === "New task"), "the program's New task field");
      await tapGui("New task");
      adb("shell", "input", "text", "Buy%smilk");
      await sleep(300);
      adb("shell", "input", "keyevent", "66");
      await untilGui((g) => g.some((n) => n.label === "Buy milk") && g.some((n) => n.label === "2 tasks left"), "the program to add the task");
      await tapGui("Buy milk");
      await untilGui((g) => g.some((n) => n.label === "1 task left"), "the program to toggle the task");
      shot("playground-gui");
      await tap(tree(), "Stop");
      await until((t) => !has("Program window")(t), "Stop");
    });
  }
}

adb("shell", "setprop", "debug.ceangal.a11y", "0");
adb("shell", "setprop", "debug.ceangal.gui_a11y", "0");
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
