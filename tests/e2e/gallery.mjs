// The standard controls (ceangal.widgets) in a real browser: apps/gallery's
// web build, driven through its accessibility tree as a user and a screen
// reader would see it.
//   node tests/e2e/gallery.mjs <web dir> [--shots DIR]
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch } from "../lib/cdp.mjs";
import { serve } from "../lib/serve.mjs";

const args = process.argv.slice(2);
const dir = resolve(args[0] || "out/gallery/web");
const shots = args.includes("--shots") ? resolve(args[args.indexOf("--shots") + 1]) : null;
if (shots) mkdirSync(shots, { recursive: true });

const server = await serve(dir);
const page = await launch({ width: 520, height: 1500 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = (e) => page.eval(e);
async function waitFor(fn, what, ms = 15000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`); await sleep(80); }
}
// [label, role, aria-checked, aria-selected, aria-disabled, valuetext, x, y]
const nodes = () => ev(`[...document.querySelectorAll("[data-ceangal-a11y] [aria-label]")].map((e) => { const r = e.getBoundingClientRect(); return { label: e.getAttribute("aria-label"), role: e.getAttribute("role"), checked: e.getAttribute("aria-checked"), selected: e.getAttribute("aria-selected"), disabled: e.getAttribute("aria-disabled"), value: e.getAttribute("aria-valuetext"), x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, w: r.width }; })`);
const find = async (label) => (await nodes()).find((n) => n.label === label);
const status = async () => ((await nodes()).find((n) => n.label?.startsWith("status: "))?.label || "").slice(8);
async function mouse(type, x, y, buttons = 0) {
  await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
}
async function click(label, dx = 0) {
  const n = await waitFor(() => find(label), `"${label}"`);
  await mouse("mouseMoved", n.x + dx, n.y);
  await mouse("mousePressed", n.x + dx, n.y, 1);
  await mouse("mouseReleased", n.x + dx, n.y);
}
async function key(code, keyName) {
  for (const type of ["rawKeyDown", "keyUp"]) await page.send("Input.dispatchKeyEvent", { type, key: keyName, code, windowsVirtualKeyCode: { Enter: 13, Tab: 9, Space: 32, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, Escape: 27 }[code] });
}
async function expectStatus(want, what) {
  await waitFor(async () => (await status()) === want, `${what}: status "${want}" (is "${await status()}")`);
  console.log(`ok   ${what}`);
}
async function expectNode(label, check, what) {
  await waitFor(async () => { const n = await find(label); return n && check(n); }, `${what} (${JSON.stringify(await find(label))})`);
  console.log(`ok   ${what}`);
}
const shot = async (name) => { if (shots) writeFileSync(join(shots, `${name}.png`), await page.screenshot()); };

let ok = false;
try {
  await page.goto(`${server.url}/index.html`);
  await waitFor(() => find("Save"), "the gallery");
  await shot("gallery-dark");

  // roles and states as assistive technology gets them
  await expectNode("Save", (n) => n.role === "button", "a button is a button");
  await expectNode("Unavailable", (n) => n.disabled === "true", "a disabled button is announced as unavailable");
  await expectNode("Subscribe to updates", (n) => n.role === "checkbox" && n.checked === "false", "a checkbox starts unchecked");
  await expectNode("Wi-Fi", (n) => n.role === "switch" && n.checked === "true", "a switch is a switch, on");
  await expectNode("Medium", (n) => n.role === "radio" && n.checked === "true", "the picked radio button is checked");
  await expectNode("Size", (n) => n.role === "radiogroup", "radio buttons are a group");
  await expectNode("Controls", (n) => n.role === "tab" && n.selected === "true", "the picked segment is a selected tab");
  await expectNode("Volume", (n) => n.role === "slider" && n.value === "40", "a slider is a slider with its value");
  await expectNode("Upload", (n) => n.role === "progressbar" && n.value === "40%", "a progress bar reads as a percentage");

  // pointer
  await click("Save"); await expectStatus("saved", "a click runs the button");
  await click("Unavailable"); await sleep(300);
  if ((await status()) !== "saved") throw new Error("a disabled button ran its action");
  console.log("ok   a disabled button does nothing");
  await click("Subscribe to updates"); await expectStatus("subscribed on", "a click on a checkbox's label checks it");
  await expectNode("Subscribe to updates", (n) => n.checked === "true", "…and it is announced as checked");
  await click("Wi-Fi"); await expectStatus("wi-fi off", "a click turns a switch off");
  await click("Large"); await expectStatus("size 2", "a click picks a radio button");
  // the slider: a click 3/4 along its track
  const vol = await find("Volume");
  const trackX = vol.left + vol.w * 0.62;
  await mouse("mousePressed", trackX, vol.y, 1); await mouse("mouseReleased", trackX, vol.y);
  await waitFor(async () => (await status()).startsWith("volume "), "a click on the track sets the value");
  console.log(`ok   a click on the slider's track sets it (${await status()})`);

  // keyboard: Tab to a control, Enter / Space / arrows
  await click("Save");
  await key("Tab", "Tab"); await key("Enter", "Enter"); await expectStatus("cancelled", "Tab moves to the next button, Enter presses it");
  await click("Large");
  await key("ArrowUp", "ArrowUp"); await expectStatus("size 1", "an arrow moves the radio choice");
  await click("Volume", 0);
  const before = await status();
  await key("ArrowRight", "ArrowRight");
  await waitFor(async () => (await status()) !== before, "Right moves the slider");
  console.log(`ok   Right moves the slider (${before} → ${await status()})`);

  // a text field: typed text shows up where the app reads it
  await click("Name");
  await page.send("Input.insertText", { text: "Ada" });
  await waitFor(async () => (await nodes()).some((n) => n.label === "Hello, Ada"), "typed text in the app");
  console.log("ok   a text field takes typed text");

  // a toast is a status, read out through the page's polite live region;
  // a tooltip shows with keyboard focus, as a tooltip
  await click("Notify");
  await expectNode("Saved to drafts", (n) => n.role === "status", "a toast is a status");
  await waitFor(() => ev(`document.querySelector("[data-ceangal-live=polite]")?.textContent === "Saved to drafts"`), "the toast in the polite live region");
  console.log("ok   a toast is announced (polite live region)");
  await click("Cancel"); await key("Tab", "Tab");
  await expectNode("Asks before deleting everything", (n) => n.role === "tooltip", "a tooltip shows on keyboard focus, as a tooltip");
  await click("Save");
  await waitFor(async () => !(await find("Asks before deleting everything")), "the tooltip goes when focus moves by pointer");
  const del = await find("Delete");
  await mouse("mouseMoved", del.x, del.y);
  await expectNode("Asks before deleting everything", (n) => n.role === "tooltip", "a tooltip shows when the pointer rests on its control");
  await mouse("mouseMoved", 6, 6);

  // a dialog: opens over the page, its buttons work, the backdrop dismisses
  await click("Delete"); await expectStatus("asking", "a button opens the dialog");
  await expectNode("Delete everything?", (n) => n.role === "dialog", "the dialog is announced as a dialog");
  await shot("gallery-dialog");
  await click("Keep"); await expectStatus("kept", "a dialog button closes it");
  await click("Delete"); await expectStatus("asking", "the dialog opens again");
  await mouse("mousePressed", 6, 6, 1); await mouse("mouseReleased", 6, 6);
  await expectStatus("dismissed", "a click on the backdrop dismisses it");

  // the light theme, the list section
  await click("Dark theme"); await expectStatus("light", "the theme switch");
  await shot("gallery-light");
  await click("Lists"); await expectStatus("tab 1", "a segment switches the section");
  await click("Inbox, 3 new"); await expectStatus("inbox", "a list row runs its action");
  if (await ev(`getComputedStyle(document.getElementById("crashed")).display !== "none"`)) throw new Error("the app crashed");
  ok = true;
} catch (e) {
  console.log(`FAIL ${e.message}`);
  await shot("gallery-fail");
} finally {
  await page.close();
  server.server.close();
}
process.exit(ok ? 0 : 1);
