// tests/apps/services on an Android device or emulator: what TalkBack sees
// (the AccessKit tree, read through uiautomator like any accessibility
// service), a file saved by ceangal.save_file landing in the shared
// Downloads folder (MediaStore), the clipboard write reaching the system, and
// open_text_file through the system picker (cancelled, then that file picked).
//   node tests/e2e/android_services.mjs [apk]
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.HOME, "Library/Android/sdk");
const adbPath = existsSync(join(sdk, "platform-tools/adb")) ? join(sdk, "platform-tools/adb") : "adb";
const adb = (...a) => execFileSync(adbPath, a, { encoding: "utf8", maxBuffer: 64 << 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const apk = process.argv[2] || "tests/apps/services/build/android/services.apk";
const pkg = "dev.almide.ceangal.services";

function tree() {
  const lines = adb("logcat", "-d", "-s", "ceangal").split("\n").map((l) => l.replace(/^.*?ceangal\s*:\s?/, ""));
  const start = lines.findLastIndex((l) => l.startsWith("a11y-begin"));
  if (start < 0) return null;
  const scale = Number(lines[start].split(" ")[1]);
  const nodes = [];
  for (const l of lines.slice(start + 1)) {
    if (l.startsWith("a11y-end")) return { scale, nodes };
    const f = l.split("\t");
    nodes.push({ x: +f[1], y: +f[2], w: +f[3], h: +f[4], label: f[6] || "" });
  }
  return null;
}
async function until(pred, what, ms = 20000) {
  const t0 = Date.now();
  for (;;) { const t = tree(); if (t && pred(t)) return t; if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}; labels: ${(t?.nodes || []).map((n) => n.label).join(" | ")}`); await sleep(400); }
}
async function tap(label) {
  const t = await until((t) => t.nodes.some((n) => n.label === label), `"${label}"`);
  const n = t.nodes.find((n) => n.label === label);
  adb("shell", "input", "touchscreen", "tap", String(Math.round((n.x + n.w / 2) * t.scale)), String(Math.round((n.y + n.h / 2) * t.scale)));
}

// The system picker (DocumentsUI) on screen: its nodes, by uiautomator.
function screen() {
  adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  return adb("shell", "cat", "/sdcard/ui.xml");
}
async function pickerUp() {
  for (let i = 0; i < 30; i++) { if (/package="com\.(google\.)?android\.documentsui"/.test(screen())) return; await sleep(500); }
  throw new Error("the system picker did not open");
}
const centre = (b) => { const m = b.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); return [Math.round((+m[1] + +m[3]) / 2), Math.round((+m[2] + +m[4]) / 2)]; };
function find(xml, attr, value) {
  const re = new RegExp(`<node[^>]*${attr}="${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*bounds="([^"]+)"`);
  const m = xml.match(re);
  return m ? centre(m[1]) : null;
}
// Tap `name` in the picker, going to Downloads first when it is not shown.
async function pickFile(name) {
  for (let i = 0; i < 20; i++) {
    const xml = screen();
    const at = find(xml, "text", name);
    if (at) { adb("shell", "input", "touchscreen", "tap", String(at[0]), String(at[1])); return; }
    // the roots drawer, then Downloads
    const roots = find(xml, "content-desc", "Show roots");
    const downloads = find(xml, "text", "Downloads");
    if (downloads) adb("shell", "input", "touchscreen", "tap", String(downloads[0]), String(downloads[1]));
    else if (roots) adb("shell", "input", "touchscreen", "tap", String(roots[0]), String(roots[1]));
    await sleep(800);
  }
  throw new Error(`${name} not found in the picker`);
}

let ok = false;
try {
  adb("install", "-r", apk);
  // injected taps as a finger, not a stylus (Gboard's handwriting)
  adb("shell", "settings", "put", "secure", "stylus_handwriting_enabled", "0");
  adb("shell", "setprop", "debug.ceangal.a11y", "1");
  adb("shell", "rm", "-f", "/sdcard/Download/services.txt");
  adb("shell", "am", "force-stop", pkg);
  adb("logcat", "-c");
  adb("shell", "am", "start", "-n", `${pkg}/android.app.NativeActivity`);
  await until((t) => t.nodes.some((n) => n.label === "Export"), "the app");
  console.log("ok   started");

  // accessibility services (TalkBack, uiautomator) see the app's views
  let seen = "";
  for (let i = 0; i < 10 && !(seen.includes('content-desc="Export"') && seen.includes('content-desc="no file"')); i++) {
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
    seen = adb("shell", "cat", "/sdcard/ui.xml");
    await sleep(500);
  }
  for (const want of ['content-desc="Services"', 'content-desc="Export"', 'content-desc="no file"', 'content-desc="twice 42 6"'])
    if (!seen.includes(want)) throw new Error(`accessibility services do not see ${want}: ${(seen.match(/content-desc="[^"]+"/g) || []).join(" ")}`);
  console.log("ok   accessibility services see the app (window, buttons, text)");

  await tap("Export");
  await until((t) => t.nodes.some((n) => n.label.startsWith("file 200 ")), "the save's answer");
  const saved = adb("shell", "cat", "/sdcard/Download/services.txt");
  if (saved.trim() !== "exported by ceangal") throw new Error(`Downloads/services.txt holds ${JSON.stringify(saved)}`);
  console.log("ok   save_file wrote Download/services.txt (MediaStore)");

  const overlays = () => (adb("logcat", "-d").match(/ClipboardOverlay/g) || []).length;
  const before = overlays();
  await tap("Copy");
  await sleep(1500);
  if (overlays() > before) console.log("ok   copy_text reached the system clipboard (its overlay showed)");
  else console.log("note copy_text: no clipboard overlay seen (older Android shows none)");

  // the system picker: Back cancels it
  await tap("Open");
  await pickerUp();
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await until((t) => t.nodes.some((n) => n.label === "file 499 "), "the cancelled open's answer");
  console.log("ok   open_text_file: the system picker, Back answers 499");

  // and picking the file saved above returns its bytes
  await tap("Open");
  await pickerUp();
  await pickFile("services.txt");
  await until((t) => t.nodes.some((n) => n.label === "file 200 exported by ceangal"), "the picked file's contents");
  console.log("ok   open_text_file: services.txt picked in the system picker, its bytes returned");
  ok = true;
} catch (e) {
  console.log(`FAIL ${e.message}`);
}
process.exit(ok ? 0 : 1);
