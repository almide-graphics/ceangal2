// The old playground's contract, on the new one: every fixture
// (apps/playground/tests/fixtures, copied from almide/playground) and every
// bundled example must print byte-identical stdout when run natively by the
// CLI and when compiled + run by the playground's own in-browser compiler
// service (hosts/web/runner-worker.js — the path the Run button takes).
//   node tests/e2e/fixtures.mjs [--only <name>]
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../lib/cdp.mjs";
import { serve } from "../lib/serve.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const almide = join(root, "tools/almide");
const fixturesDir = join(root, "apps/playground/tests/fixtures");
const examplesDir = join(root, "apps/playground/assets/examples");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
if (!process.env.SKIP_BUILD) execFileSync(join(root, "tools/build_web.sh"), { stdio: "inherit", env: { ...process.env, SKIP_COMPILER: process.env.SKIP_COMPILER ?? "1" } });

// Programs as the playground holds them: { name: content } plus the entry.
const programs = [];
for (const f of readdirSync(fixturesDir).filter((f) => f.endsWith(".almd")).sort()) {
  programs.push({ id: f.replace(/\.almd$/, ""), files: { "main.almd": readFileSync(join(fixturesDir, f), "utf8") }, marker: `${f.replace(/_test\.almd$/, "")}: ok` });
}
const manifest = JSON.parse(readFileSync(join(examplesDir, "manifest.json"), "utf8"));
for (const cat of manifest.categories) for (const ex of cat.examples) {
  const files = {};
  for (const name of ex.files) files[name] = readFileSync(join(examplesDir, ex.id, name), "utf8");
  programs.push({ id: `example ${ex.id}`, files, gui: cat.id === "gui" });
}
const selected = programs.filter((p) => !only || p.id === only || p.id === `example ${only}`);

// Native expectation: materialised like a local project (src/*.almd, data at the root).
const scratch = join(realpathSync(tmpdir()), `ceangal2-fixtures-${process.pid}`);
function native(p) {
  const dir = join(scratch, p.id.replace(/\W+/g, "_"));
  mkdirSync(join(dir, "src"), { recursive: true });
  // GUI programs build against this repo's packages (what the playground bundles).
  const deps = p.gui ? `\n[dependencies]\nceangal = { path = "${join(root, "ceangal")}" }\nsnaidhm = { path = "${join(root, "snaidhm")}" }\n` : "";
  writeFileSync(join(dir, "almide.toml"), `[package]\nname = "fixture"\nversion = "0.1.0"\n${deps}`);
  for (const [name, content] of Object.entries(p.files)) writeFileSync(name.endsWith(".almd") ? join(dir, "src", name) : join(dir, name), content);
  if (p.gui) {
    execFileSync(almide, ["build", "src/main.almd", "--target", "wasm", "-o", join(dir, "app.wasm")], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600000 });
    return "(gui)";
  }
  return execFileSync(almide, ["run", "src/main.almd"], { cwd: dir, env: { ...process.env, PWD: dir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000, maxBuffer: 256 << 20 }).trimEnd();
}

const { server, url } = await serve(root);
const page = await launch();
let failed = 0, loose = 0;
try {
  await page.goto(`${url}/tests/e2e/web.html`);
  await page.eval(`(async () => {
    const w = new Worker(new URL("/dist/web/runner-worker.js?compiler=" + encodeURIComponent(location.origin + "/dist/web/compiler/almide_compiler_service.js"), location.origin), { type: "module" });
    let next = 1;
    const waiting = new Map();
    w.onmessage = (e) => {
      const m = e.data, r = waiting.get(m.id);
      if (!r) return;
      if (m.event === "stdout") r.out.push(m.line);
      else if (m.event === "stderr") r.err.push(m.line);
      else if (m.event === "gui") { waiting.delete(m.id); r.resolve({ ok: true, exitCode: 0, gui: true, stdout: "(gui)", stderr: "" }); }
      else if (m.done) { waiting.delete(m.id); r.resolve({ ok: m.ok, exitCode: m.exitCode, phase: m.phase, error: m.error, stdout: r.out.join("\\n"), stderr: r.err.join("\\n") }); }
    };
    window.runProgram = (files) => new Promise((resolve) => { const id = next++; waiting.set(id, { resolve, out: [], err: [] }); w.postMessage({ id, op: "run", files, entry: "main.almd" }); });
    return true;
  })()`);
  for (const p of selected) {
    // A program whose native output differs between two runs (random, time)
    // is compared on success only.
    let want, deterministic = true;
    try { want = native(p); deterministic = p.gui || native(p) === want; } catch (e) { failed++; console.log(`FAIL ${p.id} [native]: ${(e.stderr || e.message).toString().slice(0, 400)}`); continue; }
    if (p.marker && !want.endsWith(p.marker)) { failed++; console.log(`FAIL ${p.id} [native]: no "${p.marker}"`); continue; }
    const got = await page.eval(`runProgram(${JSON.stringify(p.files)})`, 180000);
    const stdout = got.stdout.trimEnd();
    if (p.gui && !got.gui) { failed++; console.log(`FAIL ${p.id} [playground]: not recognised as a GUI program`); }
    else if (!got.ok || got.exitCode !== 0) { failed++; console.log(`FAIL ${p.id} [playground]: ${got.phase || "exit " + got.exitCode}: ${(got.error || got.stderr || "").slice(0, 400)}`); }
    else if (!deterministic) loose++, console.log(`ok   ${p.id} (nondeterministic: ran, ${stdout.split("\n").length} lines)`);
    else if (stdout !== want) { failed++; console.log(`FAIL ${p.id} [drift]\n  native:     ${JSON.stringify(want).slice(0, 300)}\n  playground: ${JSON.stringify(stdout).slice(0, 300)}`); }
    else console.log(`ok   ${p.id}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
  await page.close();
  server.close();
}
console.log(`${selected.length - failed}/${selected.length} passed (${selected.length - failed - loose} byte-identical, ${loose} nondeterministic compared on success)`);
process.exit(failed ? 1 : 0);
