// apps/gallery on an Android device or emulator, as TalkBack sees it: the
// AccessKit tree read through uiautomator like any accessibility service.
// Each control's role reaches Android as its widget class; a toast's text
// and a long-pressed control's tooltip appear in the tree; a virtual list is
// a ListView.
//   node tests/e2e/android_gallery.mjs [apk]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.HOME, "Library/Android/sdk");
const adbPath = existsSync(join(sdk, "platform-tools/adb")) ? join(sdk, "platform-tools/adb") : "adb";
const adb = (...a) => execFileSync(adbPath, a, { encoding: "utf8", maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const apk = process.argv[2] || "out/gallery/android/gallery.apk";
const pkg = "dev.almide.ceangal.gallery";

// What accessibility services see: each node's class, description and
// bounds (physical px).
function screen() {
  adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  const xml = adb("shell", "cat", "/sdcard/ui.xml");
  return [...xml.matchAll(/<node [^>]*>/g)].map(([n]) => {
    const at = (k) => (n.match(new RegExp(` ${k}="([^"]*)"`)) || [])[1] || "";
    const b = at("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/) || [0, 0, 0, 0, 0];
    return { cls: at("class"), desc: at("content-desc"), text: at("text"), x: (+b[1] + +b[3]) / 2, y: (+b[2] + +b[4]) / 2 };
  });
}
const named = (nodes, s) => nodes.find((n) => n.desc === s || n.text === s);
const shown = (nodes) => nodes.map((n) => `${n.desc || n.text}(${n.cls.replace(/^android\.(widget|view)\./, "")})`).filter((s) => !s.startsWith("(")).join(" ");
async function until(pred, what, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const nodes = screen();
    if (pred(nodes)) return nodes;
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}; accessibility services see: ${shown(nodes)}`);
    await sleep(500);
  }
}
const ok = (what) => console.log(`ok   ${what}`);

let passed = false;
try {
  adb("install", "-r", apk);
  adb("shell", "settings", "put", "secure", "stylus_handwriting_enabled", "0");
  // the on-screen keyboard even with a hardware one attached (CI's emulator has
  // one: Gboard then shows only a strip, and the app sees no keyboard)
  adb("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1");
  adb("shell", "am", "force-stop", pkg);
  adb("shell", "am", "start", "-n", `${pkg}/android.app.NativeActivity`);
  let nodes = await until((ns) => named(ns, "Save") && named(ns, "Volume"), "the gallery");
  ok("started");

  // each role as the widget class TalkBack announces
  const want = [
    ["Save", "android.widget.Button"],
    ["Subscribe to updates", "android.widget.CheckBox"],
    ["Wi-Fi", "android.widget.ToggleButton"],
    ["Small", "android.widget.RadioButton"],
    ["Country", "android.widget.Spinner"],
    ["Volume", "android.widget.SeekBar"],
    ["Upload", "android.widget.ProgressBar"],
    ["Name", "android.widget.EditText"],
  ];
  for (const [label, cls] of want) {
    nodes = await until((ns) => named(ns, label), `"${label}"`);
    const n = named(nodes, label);
    if (n.cls !== cls) throw new Error(`"${label}" is a ${n.cls}, not a ${cls}`);
  }
  ok(`controls reach TalkBack with their roles (${want.map((w) => w[1].split(".").pop()).join(", ")})`);

  // a toast (a polite live region) is in the tree while it shows
  const notify = named(nodes, "Notify");
  adb("shell", "input", "touchscreen", "tap", String(Math.round(notify.x)), String(Math.round(notify.y)));
  await until((ns) => named(ns, "Saved to drafts"), "the toast");
  ok("a toast's text reaches TalkBack");

  // a long press shows a tooltip and doesn't press the control
  await until((ns) => !named(ns, "Saved to drafts"), "the toast to go", 10000);
  const del = named(screen(), "Delete");
  const [x, y] = [String(Math.round(del.x)), String(Math.round(del.y))];
  adb("shell", "input", "touchscreen", "swipe", x, y, x, y, "900");
  nodes = await until((ns) => named(ns, "Asks before deleting everything"), "the tooltip");
  if (named(nodes, "Delete everything?")) throw new Error("the long press pressed Delete");
  ok("a long press shows a tooltip to TalkBack, without pressing the control");

  // the virtual list is a list of all its rows, though only some are built
  await until((ns) => !named(ns, "Asks before deleting everything"), "the tooltip to go", 10000);
  const lists = named(screen(), "Lists");
  adb("shell", "input", "touchscreen", "tap", String(Math.round(lists.x)), String(Math.round(lists.y)));
  nodes = await until((ns) => named(ns, "Languages"), "the Lists tab");
  for (let i = 0; i < 8 && !named(nodes, "10000 items"); i++) {
    adb("shell", "input", "touchscreen", "swipe", "500", "1500", "500", "500", "300");
    await sleep(800);
    nodes = screen();
  }
  const list = named(nodes, "10000 items");
  if (!list) throw new Error(`no "10000 items" list; accessibility services see: ${shown(nodes)}`);
  if (list.cls !== "android.widget.ListView") throw new Error(`the virtual list is a ${list.cls}, not a ListView`);
  ok("a virtual list reaches TalkBack as a ListView of 10000 items");
  passed = true;
} catch (e) {
  console.log(`FAIL ${e.message}`);
} finally {
  try { adb("shell", "screencap", "-p", "/sdcard/g.png"); adb("pull", "/sdcard/g.png", "out/e2e/android-gallery.png"); } catch {}
}
process.exit(passed ? 0 : 1);
