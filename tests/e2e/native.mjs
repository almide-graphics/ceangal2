// The native playground, headless: each scenario runs the binary with a
// script (ceangal/native/host.rs) and asserts on the accessibility tree it
// leaves behind (CEANGAL_A11Y_DUMP) — the same labels the web E2E uses.
//   node tests/e2e/native.mjs [--bin out/native/playground] [--skip-fixtures]
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { EDIT_TODO, autorunLink, programs, reference } from "../lib/fixtures.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const exe = process.platform === "win32" ? ".exe" : "";
const binArg = process.argv.includes("--bin") ? process.argv[process.argv.indexOf("--bin") + 1] : null;
const bin = binArg ? (binArg.startsWith("/") || /^[A-Za-z]:/.test(binArg) ? binArg : join(process.cwd(), binArg)) : join(root, `out/native/playground${exe}`);
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
  for (const l of ["Run", "Examples", "More", "AI assistant", "Code editor", "Output", "Visual", "Rust", "AST"]) assert(find(boot, l), `missing ${l}`);
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
  // Share and Export live in the ⋯ menu
  const menu = session("native-more", `wait; click ${at("More")}; frames 2`);
  const exp = find(menu, "Export");
  assert(exp && find(menu, "Share"), `More menu: ${menu.nodes.map((n) => n.label)}`);
  const s = session("native-export", `wait; click ${at("More")}; frames 2; click ${center(exp)}; wait`);
  assert(s.downloads.length === 1, "no download");
  const zip = readFileSync(s.downloads[0]);
  assert(zip.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])), "not a zip");
  for (const f of ["almide-playground/almide.toml", "almide-playground/src/main.almd"]) assert(zip.includes(Buffer.from(f)), `zip lacks ${f}`);
});

step("user GUI: the Todo example is edited, runs as a window, takes input, stops", () => {
  const work = mkdtempSync(join(tmpdir(), "pg-gui-"));
  const gui = join(work, "gui.txt");
  const launch = "https://x.test/?example=todo";
  // the edit: the cursor to the top of the source, six lines down (the
  // first task), and a new task typed in front of it
  const box = find(session("native-gui-boot", "wait", { launch }), "Code editor");
  assert(box, "no code editor");
  const edit = `click ${box.x + 4} ${box.y + 16}; ${Array(6).fill("key 13 0").join("; ")}; text ${EDIT_TODO}; frames 2`;
  const base = `wait; ${edit}; click ${at("Run")}; wait; frames 2`;
  const first = session("native-gui-start", base, { launch, env: { CEANGAL_GUI_A11Y: gui } });
  assert((find(first, "Code editor")?.value || "").includes(EDIT_TODO.trim()), "the edit is not in the editor");
  const win = find(first, "Program window");
  assert(win, `no program window: ${texts(first)}`);
  const g = () => readFileSync(gui, "utf8").split("\n").filter(Boolean).map((l) => { const [label, x, y, w, h] = l.split("\t"); return { label, x: +x + win.x, y: +y + win.y, w: +w, h: +h }; });
  assert(g().some((n) => n.label === "Edited") && g().some((n) => n.label === "2 tasks left"), `edited program: ${g().map((n) => n.label)}`);
  const field = g().find((n) => n.label === "New task");
  assert(field, "no New task field");
  const s = session("native-gui", `${base}; click ${center(field)}; text 牛乳を買う; key 1 0; frames 2`, { launch, env: { CEANGAL_GUI_A11Y: gui } });
  assert(g().some((n) => n.label === "牛乳を買う") && g().some((n) => n.label === "3 tasks left"), `program tree ${g().map((n) => n.label)}`);
  const item = g().find((n) => n.label === "牛乳を買う");
  const t = session("native-gui-toggle", `${base}; click ${center(field)}; text 牛乳を買う; key 1 0; frames 2; click ${center(item)}; frames 2; click ${at("Run")}; wait`, { launch, env: { CEANGAL_GUI_A11Y: gui } });
  assert(g().some((n) => n.label === "2 tasks left"), "toggle");
  assert(texts(t).includes("Stopped") && !find(t, "Program window"), `after Stop: ${texts(t)}`);
  rmSync(work, { recursive: true, force: true });
});

step("AI: generate, repair once, against a mock provider (real HTTP)", () => {
  // A mock Anthropic endpoint in a child process (the binary's ureq talks to it).
  const work = mkdtempSync(join(tmpdir(), "pg-ai-"));
  const assets = join(work, "assets");
  mkdirSync(join(assets, "ai"), { recursive: true });
  const port = 18000 + Math.floor(Math.random() * 1000);
  writeFileSync(join(assets, "ai/base.txt"), `http://127.0.0.1:${port}`);
  const replies = [
    "effect fn main() -> Unit = {\n  let n: Int = \"oops\"\n  println(int.to_string(n))\n}\n",
    "effect fn main() -> Unit = println(\"fixed natively\")\n",
  ];
  const server = join(work, "server.mjs");
  writeFileSync(server, `
    import { createServer } from "node:http";
    import { appendFileSync } from "node:fs";
    const replies = ${JSON.stringify(replies)};
    let n = 0;
    createServer((req, res) => {
      let body = ""; req.on("data", (d) => body += d); req.on("end", () => {
        appendFileSync(${JSON.stringify(join(work, "calls.log"))}, JSON.stringify({ url: req.url, key: req.headers["x-api-key"], body: JSON.parse(body) }) + "\\n");
        res.writeHead(200, { "content-type": "text/event-stream" });
        const text = replies[Math.min(n++, replies.length - 1)];
        for (let i = 0; i < text.length; i += 9) res.write("data: " + JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: text.slice(i, i + 9) } }) + "\\n\\n");
        res.end("data: [DONE]\\n\\n");
      });
    }).listen(${port}, "127.0.0.1");
    setTimeout(() => process.exit(0), 120000);
  `);
  const child = spawn(process.execPath, [server], { stdio: "ignore" });
  try {
    const t0 = Date.now(); while (Date.now() - t0 < 600) {}   // let it listen
    // the key card first; the prompt box appears once a key is set
    const aiBoot = session("native-ai-boot", `wait; click ${at("AI assistant")}; frames 2`);
    const keyAt = center(find(aiBoot, "API key") || (() => { throw new Error(`no API key: ${aiBoot.nodes.map((n) => n.label)}`); })());
    const keyed = session("native-ai-keyed", `wait; click ${at("AI assistant")}; frames 2; click ${keyAt}; text sk-ant-native; frames 2`);
    const promptAt = center(find(keyed, "Prompt") || (() => { throw new Error(`no Prompt: ${keyed.nodes.map((n) => n.label)}`); })());
    const sep = process.platform === "win32" ? ";" : ":";
    const s = session("native-ai", `wait; click ${at("AI assistant")}; frames 2; click ${keyAt}; text sk-ant-native; frames 2; click ${promptAt}; text say hi; key 1 0; wait; frames 2; wait; frames 2; wait`, {
      env: { CEANGAL_ASSETS: [assets, join(root, "apps/playground/assets"), join(root, "assets")].join(sep) },
    });
    assert(texts(s).some((t) => t.startsWith("Repaired (1)")), `status: ${texts(s)}`);
    const calls = readFileSync(join(work, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert(calls.length === 2 && calls[0].key === "sk-ant-native" && calls[0].url === "/v1/messages", JSON.stringify(calls.map((c) => [c.url, c.key])));
    assert(/Compile error/.test(calls[1].body.messages.at(-1).content), "repair carries the error");
    assert((find(s, "Code editor")?.value || "").includes("fixed natively"), "fixed code in the editor");
    assert(texts(s).includes("Fixed — compiled and ran"), `conversation: ${texts(s)}`);
  } finally {
    child.kill();
    rmSync(work, { recursive: true, force: true });
  }
});

// The old playground's fixtures and every example: byte-identical stdout
// against the CLI (random programs: ran and exited 0).
if (!process.argv.includes("--skip-fixtures")) step("fixtures and examples run natively, matching the CLI", () => {
  const bad = [];
  for (const p of programs()) {
    const s = session(`native-fx-${p.id}`, "wait; frames 2; wait", { launch: autorunLink(p) });
    if (!texts(s).includes("Exited 0")) { bad.push(`${p.id}: ${texts(s).find((t) => /error|Exited|Stopped/.test(t))}`); continue; }
    const want = reference(p);
    if (want !== null && s.runLog.trimEnd() !== want) bad.push(`${p.id}: drift`);
  }
  assert(bad.length === 0, bad.join("; "));
});

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
