// The native playground, headless: each scenario runs the binary with a
// script (ceangal/native/host.rs) and asserts on the accessibility tree it
// leaves behind (CEANGAL_A11Y_DUMP) — the same labels the web E2E uses.
//   node tests/e2e/native.mjs [--bin out/playground] [--skip-fixtures]
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const exe = process.platform === "win32" ? ".exe" : "";
const binArg = process.argv.includes("--bin") ? process.argv[process.argv.indexOf("--bin") + 1] : null;
const bin = binArg ? (binArg.startsWith("/") || /^[A-Za-z]:/.test(binArg) ? binArg : join(process.cwd(), binArg)) : join(root, `out/playground${exe}`);
if (!existsSync(bin)) execFileSync("bash", [join(root, "tools/build_native.sh")], { stdio: "inherit" });
const out = join(root, "out/e2e-native");
mkdirSync(out, { recursive: true });
const SC = process.platform === "darwin" ? 8 : 2;   // Cmd on macOS, Ctrl elsewhere
const W = 1200, H = 760;

// One headless session: returns { nodes, png, runLog, downloads }.
function session(name, script, { launch = "", env = {} } = {}) {
  const work = mkdtempSync(join(tmpdir(), "pg-native-"));
  const dump = join(work, "a11y.txt"), runLog = join(work, "run.log"), dl = join(work, "dl");
  mkdirSync(dl);
  const png = join(out, `${name}.png`);
  const r = spawnSync(bin, [], {
    env: {
      ...process.env, CEANGAL_HEADLESS: png, CEANGAL_SIZE: `${W}x${H}`, CEANGAL_SCRIPT: script, CEANGAL_LAUNCH: launch,
      CEANGAL_ASSETS: [join(root, "apps/playground/assets"), join(root, "assets")].join(process.platform === "win32" ? ";" : ":"),
      CEANGAL_DATA_DIR: join(work, "data"), CEANGAL_A11Y: "1", CEANGAL_A11Y_DUMP: dump, CEANGAL_RUN_LOG: runLog,
      CEANGAL_DOWNLOADS: dl, ...env,
    },
    encoding: "utf8", timeout: 300000,
  });
  if (r.error) throw new Error(`${name}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${name}: exit ${r.status} ${(r.stderr || "").slice(-800)}`);
  const nodes = existsSync(dump) ? readFileSync(dump, "utf8").split("\n").filter(Boolean).map((l) => {
    const [role, x, y, w, h, flags, label, value] = l.split("\t");
    return { role: +role, x: +x, y: +y, w: +w, h: +h, flags: +flags, label, value };
  }) : [];
  const res = { nodes, png, runLog: existsSync(runLog) ? readFileSync(runLog, "utf8") : "", downloads: readdirSync(dl).map((f) => join(dl, f)) };
  return res;
}
const texts = (s) => s.nodes.filter((n) => n.role === 4).map((n) => n.label);
const find = (s, label) => s.nodes.find((n) => n.label === label);
const center = (n) => `${Math.round(n.x + n.w / 2)} ${Math.round(n.y + n.h / 2)}`;
function assert(c, m) { if (!c) throw new Error(m); }

let failed = 0;
function step(name, fn) {
  const t0 = Date.now();
  try { fn(); console.log(`ok   ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); }
}

// Layout is deterministic at a fixed size: learn where things are once.
const boot = session("native-boot", "wait");
const at = (label) => { const n = find(boot, label); if (!n) throw new Error(`no "${label}" in ${boot.nodes.map((m) => m.label)}`); return center(n); };
const setCode = (src) => `click ${at("Code editor")}; key 20 ${SC}; paste ${src}`;

step("boots with the default program", () => {
  for (const l of ["Run", "Examples", "Share", "Export", "Code editor", "Output", "Visual", "Rust", "AST"]) assert(find(boot, l), `missing ${l}`);
  assert((find(boot, "Code editor").value || "").includes("Mini Markdown"), "default program");
});

step("run streams stdout and exits 0", () => {
  const s = session("native-run", `${setCode('effect fn main() -> Unit = {\n  println("Hello, native!")\n  println(int.to_string(6 * 7))\n}\n')}; click ${at("Run")}; wait; click ${at("Output")}`);
  assert(texts(s).includes("Exited 0"), `status ${texts(s)}`);
  assert(/Hello, native! 42/.test(find(s, "Program output")?.value || ""), `output ${find(s, "Program output")?.value}`);
});

step("check-on-idle reports a type error", () => {
  const s = session("native-check", `${setCode('effect fn main() -> Unit = {\n  let x: Int = "nope"\n  println(int.to_string(x))\n}\n')}; wait; frames 2; wait`);
  assert(texts(s).some((t) => t === "1 problem"), `texts ${texts(s)}`);
});

step("compile errors land in the output", () => {
  const s = session("native-compile-error", `${setCode('effect fn main() -> Unit = println(undefined_thing)\n')}; click ${at("Run")}; wait`);
  assert(texts(s).includes("Compile error"), `texts ${texts(s)}`);
});

step("Stop ends an endless program", () => {
  const s = session("native-stop", `${setCode('effect fn main() -> Unit = {\n  var i = 0\n  while true { i = i + 1 }\n}\n')}; click ${at("Run")}; frames 30; click ${at("Run")}; wait`);
  assert(texts(s).includes("Stopped"), `texts ${texts(s)}`);
});

step("examples: FizzBuzz", () => {
  const s = session("native-fizzbuzz", `wait; click ${at("Run")}; wait; click ${at("Output")}`, { launch: "https://x.test/?example=fizzbuzz" });
  assert(texts(s).includes("Exited 0") && (find(s, "Program output")?.value || "").includes("FizzBuzz"), `texts ${texts(s)}`);
});

step("an SVG program shows in Visual", () => {
  const s = session("native-visual", `wait; click ${at("Run")}; wait; frames 2`, { launch: "https://x.test/?example=svg-art" });
  assert(find(s, "Visual output"), `no Visual output: ${texts(s)}`);
});

step("Rust and AST views", () => {
  const s = session("native-rust", `wait; click ${at("Rust")}; wait`);
  assert((find(s, "Generated Rust")?.value || "").includes("fn "), "rust");
  const a = session("native-ast", `wait; click ${at("AST")}; wait`);
  assert((find(a, "Syntax tree")?.value || "").length > 20, "ast");
});

step("export writes a runnable project zip", () => {
  const s = session("native-export", `wait; click ${at("Export")}; wait`);
  assert(s.downloads.length === 1, "no download");
  const zip = readFileSync(s.downloads[0]);
  assert(zip.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])), "not a zip");
  for (const f of ["almide-playground/almide.toml", "almide-playground/src/main.almd"]) assert(zip.includes(Buffer.from(f)), `zip lacks ${f}`);
});

step("user GUI: the Todo example runs as a window, takes input, stops", () => {
  const work = mkdtempSync(join(tmpdir(), "pg-gui-"));
  const gui = join(work, "gui.txt");
  const base = `wait; click ${at("Run")}; wait; frames 2`;
  const first = session("native-gui-start", base, { launch: "https://x.test/?example=todo", env: { CEANGAL_GUI_A11Y: gui } });
  const win = find(first, "Program window");
  assert(win, `no program window: ${texts(first)}`);
  const g = () => readFileSync(gui, "utf8").split("\n").filter(Boolean).map((l) => { const [label, x, y, w, h] = l.split("\t"); return { label, x: +x + win.x, y: +y + win.y, w: +w, h: +h }; });
  const field = g().find((n) => n.label === "New task");
  assert(field, "no New task field");
  const s = session("native-gui", `${base}; click ${center(field)}; text 牛乳を買う; key 1 0; frames 2`, { launch: "https://x.test/?example=todo", env: { CEANGAL_GUI_A11Y: gui } });
  assert(g().some((n) => n.label === "牛乳を買う") && g().some((n) => n.label === "2 tasks left"), `program tree ${g().map((n) => n.label)}`);
  const item = g().find((n) => n.label === "牛乳を買う");
  const t = session("native-gui-toggle", `${base}; click ${center(field)}; text 牛乳を買う; key 1 0; frames 2; click ${center(item)}; frames 2; click ${at("Run")}; wait`, { launch: "https://x.test/?example=todo", env: { CEANGAL_GUI_A11Y: gui } });
  assert(g().some((n) => n.label === "1 task left"), "toggle");
  assert(texts(t).includes("Stopped") && !find(t, "Program window"), `after Stop: ${texts(t)}`);
  rmSync(work, { recursive: true, force: true });
});

// The old playground's fixtures and every example: byte-identical stdout
// against the CLI (random programs: ran and exited 0).
if (!process.argv.includes("--skip-fixtures")) step("fixtures and examples run natively, matching the CLI", () => {
  const fixtures = join(root, "apps/playground/tests/fixtures");
  const examples = join(root, "apps/playground/assets/examples");
  const manifest = JSON.parse(readFileSync(join(examples, "manifest.json"), "utf8"));
  const progs = readdirSync(fixtures).filter((f) => f.endsWith(".almd")).map((f) => ({ id: f, files: { "main.almd": readFileSync(join(fixtures, f), "utf8") } }));
  for (const cat of manifest.categories) if (cat.id !== "gui") for (const ex of cat.examples) {
    const files = {};
    for (const n of ex.files) files[n] = readFileSync(join(examples, ex.id, n), "utf8");
    progs.push({ id: ex.id, files });
  }
  const bad = [];
  for (const p of progs) {
    const json = JSON.stringify({ v: 1, files: Object.entries(p.files).map(([name, content]) => ({ name, content })) });
    const code = deflateRawSync(Buffer.from(json)).toString("base64url");
    const s = session(`native-fx-${p.id}`, "wait; frames 2; wait", { launch: `https://x.test/?autorun=1#code=${code}` });
    if (!texts(s).includes("Exited 0")) { bad.push(`${p.id}: ${texts(s).find((t) => /error|Exited|Stopped/.test(t))}`); continue; }
    // CLI reference
    const dir = mkdtempSync(join(tmpdir(), "pg-cli-"));
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "almide.toml"), '[package]\nname = "fx"\nversion = "0.1.0"\n');
    for (const [n, c] of Object.entries(p.files)) writeFileSync(n.endsWith(".almd") ? join(dir, "src", n) : join(dir, n), c);
    const almideArgs = [join(root, "tools/almide"), "run", "src/main.almd"];
    const run = () => execFileSync(process.platform === "win32" ? "bash" : almideArgs[0], process.platform === "win32" ? almideArgs : almideArgs.slice(1), { cwd: dir, env: { ...process.env, PWD: dir }, encoding: "utf8", maxBuffer: 256 << 20 }).trimEnd();
    const want = run();
    // random / clock programs differ run to run (CLI seeding can repeat
    // within a second, so two equal runs prove nothing)
    const usesChance = Object.values(p.files).some((c) => /\b(random\.|env\.|time\.(now|millis)|datetime\.now)/.test(c));
    const deterministic = !usesChance && run() === want;
    rmSync(dir, { recursive: true, force: true });
    if (deterministic && s.runLog.trimEnd() !== want) bad.push(`${p.id}: drift`);
  }
  assert(bad.length === 0, bad.join("; "));
});

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
