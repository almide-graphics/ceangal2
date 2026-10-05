// `ceangal dev` end to end, on an app `ceangal new` makes in a temporary
// directory:
//   node tests/e2e/dev.mjs           the web target in headless Chrome: an edit
//                                    reloads the page with the change, a broken
//                                    edit shows the build error on the page, the
//                                    fix reloads it again
//   node tests/e2e/dev.mjs --desktop the desktop target: an edit rebuilds and
//                                    restarts the app
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch } from "../lib/cdp.mjs";

const sdk = resolve(import.meta.dirname, "../..");
const desktop = process.argv.includes("--desktop");
const port = 8600 + Math.floor(Math.random() * 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, CEANGAL_SDK: sdk };
const cli = join(sdk, "tools/ceangal");
const bash = process.platform === "win32" ? process.env.CEANGAL_BASH || "C:/Program Files/Git/bin/bash.exe" : "bash";

const work = mkdtempSync(join(tmpdir(), "ceangal-dev-"));
const app = join(work, "devcheck");
const run = (args) => new Promise((ok, fail) => {
  const p = spawn(bash, [cli, ...args], { cwd: work, env, stdio: "inherit" });
  p.on("exit", (c) => (c === 0 ? ok() : fail(new Error(`ceangal ${args.join(" ")}: exit ${c}`))));
});
await run(["new", "devcheck"]);
const main = join(app, "src/main.almd");
const original = readFileSync(main, "utf8");

let log = "";
const dev = spawn(bash, [cli, "dev", ...(desktop ? [process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux"] : ["--port", String(port)])], { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] });
for (const s of [dev.stdout, dev.stderr]) s.on("data", (d) => { log += d; process.stdout.write(d); });
let exited = null;
dev.on("exit", (c) => { exited = c; });

async function waitFor(fn, what, ms = 240000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (exited !== null) throw new Error(`ceangal dev exited (${exited}) waiting for: ${what}`);
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(200);
  }
}
const count = (re) => (log.match(re) || []).length;

let ok = false, page = null;
try {
  if (desktop) {
    await waitFor(() => log.includes("is running"), "the app starts");
    await sleep(2000);
    writeFileSync(main, original.replaceAll('"Count"', '"Tally"'));
    await waitFor(() => log.includes("ceangal dev: restarted"), "rebuild and restart after an edit");
    console.log("ok   an edit rebuilt and restarted the app");
    writeFileSync(main, original + "\nfn broken( -> \n");
    await waitFor(() => log.includes("the running app is the last good build"), "a broken edit keeps the app");
    console.log("ok   a broken edit kept the running app");
    ok = true;
  } else {
    await waitFor(() => log.includes("ceangal dev: ready at"), "the first build");
    page = await launch({ width: 480, height: 640 });
    const ev = (e) => page.eval(e);
    const labels = () => ev(`[...document.querySelectorAll("[aria-label]")].filter((e) => e.tagName !== "CANVAS").map((e) => e.getAttribute("aria-label")).join("|")`).catch(() => "");
    const overlay = () => ev(`[...document.querySelectorAll("pre")].map((e) => e.textContent).join("")`).catch(() => "");
    await page.goto(`http://127.0.0.1:${port}/`);
    await waitFor(async () => (await labels()).includes("Count"), "the app's Count button", 60000);
    console.log("ok   the page shows the app");

    writeFileSync(main, original.replaceAll('\\"Count\\"', '\\"Tally\\"').replaceAll('"Count"', '"Tally"'));
    await waitFor(async () => (await labels()).includes("Tally"), "the edit on the page after a reload");
    console.log("ok   an edit rebuilt the app and reloaded the page");

    writeFileSync(main, original.replaceAll('"Count"', '"Tally"') + "\nfn broken( -> \n");
    const err = await waitFor(async () => { const t = await overlay(); return t.includes("the build failed") ? t : null; }, "the build error on the page");
    if (!/main\.almd/.test(err)) throw new Error(`the error page does not name the file:\n${err.slice(-600)}`);
    console.log("ok   a broken edit shows the build error on the page");

    writeFileSync(main, original);
    await waitFor(async () => !(await overlay()).includes("the build failed") && (await labels()).includes("Count"), "the fixed app after a reload");
    console.log("ok   the fix cleared the error and reloaded the page");
    if (count(/ceangal dev: rebuilding/g) !== 3) throw new Error(`expected 3 rebuilds, saw ${count(/ceangal dev: rebuilding/g)}`);
    console.log("ok   one rebuild per edit");
    ok = true;
  }
} catch (e) {
  console.log(`FAIL ${e.message}`);
} finally {
  if (page) await page.close().catch(() => {});
  dev.kill();
  await sleep(500);
  if (desktop) {
    if (process.platform === "win32") for (const im of ["devcheck.exe", "ceangal.exe"]) spawn("taskkill", ["/F", "/IM", im]);
    else spawn("pkill", ["-f", join(app, "build/native/devcheck")]);
  }
  try { rmSync(work, { recursive: true, force: true }); } catch {}
}
process.exit(ok ? 0 : 1);
