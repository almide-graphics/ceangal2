// Web E2E for the playground: builds dist/web (unless SKIP_BUILD), opens it
// in headless Chrome with WebGPU, and exercises every feature through the
// accessibility tree. Screenshots land in out/e2e/.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "../lib/cdp.mjs";
import { serve } from "../lib/serve.mjs";
import { encodePng } from "../lib/png.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "out/e2e");
mkdirSync(out, { recursive: true });
if (!process.env.SKIP_BUILD) execFileSync(join(root, "tools/build_web.sh"), { stdio: "inherit", env: { ...process.env, SKIP_COMPILER: process.env.SKIP_COMPILER ?? "1" } });

const SELECT_ALL = 20, END = 13, CTRL = 2;
const { server, url } = await serve(root);
const page = await launch();
let failed = 0;

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    console.log(`ok   ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
const ev = (expr, ms) => page.eval(expr, ms);
const until = (pred, ms = 30000) => ev(`pg.until(${JSON.stringify(pred)}, ${ms})`, ms + 5000);
async function shot(name) {
  const r = await ev("pg.snapshot()");
  writeFileSync(join(out, `${name}.png`), encodePng({ width: r.width, height: r.height, rgba: new Uint8Array(Buffer.from(r.rgba, "base64")) }));
}
async function setCode(src) {
  await ev(`pg.click("Code editor")`);
  await ev(`pg.key(${SELECT_ALL}, ${CTRL})`);
  await ev(`pg.type(${JSON.stringify(src)})`);
}
function assert(c, msg) { if (!c) throw new Error(msg); }

try {
  await page.goto(`${url}/tests/e2e/web.html`);
  await until("() => true").catch(() => {});

  await step("boot shows the default program", async () => {
    await ev("pg.boot()", 120000);
    await until(`(pg) => (pg.value("Code editor") || "").includes("Mini Markdown")`);
    for (const l of ["Run", "Examples", "More", "AI assistant", "main.almd", "Output", "Visual", "Rust", "AST", "New file"]) assert(await ev(`!!pg.find(${JSON.stringify(l)})`), `missing ${l}`);
    await shot("boot");
  });

  await step("run streams stdout and exits 0", async () => {
    await setCode('effect fn main() -> Unit = {\n  println("Hello, e2e!")\n  println(int.to_string(6 * 7))\n}\n');
    await ev(`pg.click("Run")`);
    await until(`(pg) => pg.texts().includes("Exited 0")`, 60000);
    const v = await ev(`pg.value("Program output")`);
    assert(v.includes("Hello, e2e!") && v.includes("42"), `output was ${JSON.stringify(v)}`);
    await shot("run");
  });

  await step("check-on-idle reports a type error", async () => {
    await setCode('effect fn main() -> Unit = {\n  let x: Int = "nope"\n  println(int.to_string(x))\n}\n');
    await until(`(pg) => pg.texts().some((t) => t === "1 problem" || t.endsWith(" problems"))`, 30000);
    await shot("problems");
  });

  await step("compile errors land in the output", async () => {
    await ev(`pg.click("Run")`);
    await until(`(pg) => pg.texts().includes("Compile error")`, 60000);
  });

  await step("stop ends an endless program", async () => {
    await setCode('effect fn main() -> Unit = {\n  var i = 0\n  while true { i = i + 1; if i % 10000000 == 0 then println(int.to_string(i)) else () }\n}\n');
    await ev(`pg.click("Run")`);
    await until(`(pg) => pg.texts().includes("Running…")`, 60000);
    await ev(`pg.click("Stop")`);
    await until(`(pg) => pg.texts().includes("Stopped")`, 10000);
    await shot("stopped");
  });

  await step("examples menu loads and runs FizzBuzz", async () => {
    await ev(`pg.click("Examples")`);
    await ev(`pg.click("FizzBuzz")`);
    await until(`(pg) => (pg.value("Code editor") || "").toLowerCase().includes("fizz")`);
    await ev(`pg.click("Run")`);
    await until(`(pg) => pg.texts().includes("Exited 0")`, 60000);
    assert((await ev(`pg.value("Program output")`)).includes("FizzBuzz"), "no FizzBuzz in output");
  });

  await step("an SVG program shows in Visual", async () => {
    await setCode('effect fn main() -> Unit = {\n  println("<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"200\\" height=\\"200\\"><rect width=\\"200\\" height=\\"200\\" fill=\\"#7aa2f7\\"/><circle cx=\\"100\\" cy=\\"100\\" r=\\"60\\" fill=\\"#f7768e\\"/></svg>")\n}\n');
    await ev(`pg.click("Run")`);
    await until(`(pg) => !!pg.find("Visual output")`, 60000);
    await shot("visual");
  });

  await step("light / dark mode toggles and is remembered", async () => {
    const first = (await ev(`!!pg.find("Dark mode")`)) ? "Dark mode" : "Light mode";
    const second = first === "Dark mode" ? "Light mode" : "Dark mode";
    await shot(first === "Dark mode" ? "theme-light" : "theme-dark");
    await ev(`pg.click(${JSON.stringify(first)})`);
    await until(`(pg) => !!pg.find(${JSON.stringify(second)})`, 5000);
    await shot(first === "Dark mode" ? "theme-dark" : "theme-light");
    await ev(`pg.click(${JSON.stringify(second)})`);
    await until(`(pg) => !!pg.find(${JSON.stringify(first)})`, 5000);
  });

  await step("a run without a picture goes back to Output", async () => {
    await setCode('effect fn main() -> Unit = println("plain text")\n');
    await ev(`pg.click("Run")`);
    await until(`(pg) => pg.texts().includes("Exited 0")`, 60000);
    await until(`(pg) => (pg.value("Program output") || "").includes("plain text") && !pg.find("Visual output")`, 10000);
  });

  await step("Rust and AST views", async () => {
    await ev(`pg.click("Rust")`);
    await until(`(pg) => { const v = pg.value("Generated Rust") || ""; return v.includes("fn ") && !v.startsWith("// compiling"); }`, 60000);
    await ev(`pg.click("AST")`);
    await until(`(pg) => { const v = pg.value("Syntax tree") || ""; return v.length > 20 && !v.startsWith("// parsing"); }`, 30000);
    await shot("ast");
  });

  await step("tabs: add a file", async () => {
    await ev(`pg.click("New file")`);
    await until(`(pg) => pg.nodes().some((n) => n.role === 5 && (n.flags & 2))`);   // the focused rename field
    await ev(`pg.key(1)`);                                                          // Enter keeps the suggested name
    await until(`(pg) => pg.nodes().filter((n) => n.role === 8 && n.label.endsWith(".almd")).length >= 2`);
    await shot("tabs");
  });

  await step("export downloads a runnable project zip", async () => {
    await ev(`pg.click("More")`);
    await ev(`pg.click("Export")`);
    assert(!(await ev(`!!pg.find("More menu")`)), "the menu closes after a choice");
    const b64 = await ev(`pg.lastDownload()`);
    assert(b64, "no download");
    const zipPath = join(out, "export.zip");
    writeFileSync(zipPath, Buffer.from(b64, "base64"));
    const listing = execFileSync("python3", ["-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('\\n'.join(z.namelist()))", zipPath], { encoding: "utf8" });
    for (const f of ["almide-playground/almide.toml", "almide-playground/src/main.almd"]) assert(listing.includes(f), `zip lacks ${f}: ${listing}`);
  });

  await step("share copies a link", async () => {
    await ev(`pg.click("More")`);
    await ev(`pg.click("Share")`);
    await until(`(pg) => pg.texts().some((t) => t.startsWith("Share link copied"))`);
  });

  await step("share link round-trips", async () => {
    await page.goto(`${url}/tests/e2e/web.html`);
    // the program from the previous page, encoded the way share does
    const code = await ev(`(async () => {
      const files = [{ name: "main.almd", content: 'effect fn main() -> Unit = println("from a link")\\n' }];
      const json = JSON.stringify({ v: 1, files });
      const cs = new CompressionStream("deflate-raw");
      const w = cs.writable.getWriter(); w.write(new TextEncoder().encode(json)); w.close();
      const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
      let s = ""; for (const b of buf) s += String.fromCharCode(b);
      return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
    })()`);
    await ev(`pg.boot({ launch: ${JSON.stringify(`https://example.test/?autorun=1#code=`)} + ${JSON.stringify(code)} })`, 120000);
    await until(`(pg) => (pg.value("Program output") || "").includes("from a link")`, 60000);
  });

  await step("embed mode hides the chrome", async () => {
    await page.goto(`${url}/tests/e2e/web.html`);
    await ev(`pg.boot({ launch: "https://example.test/?embed=1&example=fizzbuzz" })`, 120000);
    await until(`(pg) => (pg.value("Code editor") || "").toLowerCase().includes("fizz")`);
    assert(!(await ev(`!!pg.find("Examples")`)), "Examples shown in embed mode");
    await shot("embed");
  });

  await step("narrow layout switches between code and output", async () => {
    await page.goto(`${url}/tests/e2e/web.html`);
    await ev(`pg.boot({ width: 390, height: 760, scale: 2 })`, 120000);
    await until(`(pg) => !!pg.find("Code editor")`);
    await shot("mobile-code");
    // long lines wrap instead of scrolling sideways (as almide/playground)
    await setCode('effect fn main() -> Unit = {\n  let message = "a long line that does not fit on a phone screen at all, so it wraps"\n  println(message)\n}\n');
    await new Promise((r) => setTimeout(r, 300));
    await shot("mobile-wrap");
    await ev(`pg.click("Output")`);
    await until(`(pg) => !!pg.find("Program output")`);
    await shot("mobile-output");
    // the AI sheet from the bottom bar, closed by the backdrop's ✕
    await ev(`pg.click("AI assistant")`);
    await until(`(pg) => !!pg.find("AI panel")`);
    await shot("mobile-ai");
    await ev(`pg.click("Close AI")`);
    assert(!(await ev(`!!pg.find("AI panel")`)), "the sheet closes");
    await ev(`pg.click("More")`);
    await until(`(pg) => !!pg.find("More menu")`);
    await shot("mobile-more");
    await ev(`pg.click("More")`);
  });

  await step("AI: generate, run, repair once, key kept in secret storage", async () => {
    await page.goto(`${url}/tests/e2e/web.html`);
    await ev(`pg.boot()`, 120000);
    const fence = "`".repeat(3);
    await ev(`pg.mockAI(${JSON.stringify([
      [fence + "almide\neffect fn main() -> Unit = {\n  let n: Int = \"oops\"\n", "  println(int.to_string(n))\n}\n" + fence],
      ["effect fn main() -> Unit = {\n  let n = 7 * 6\n  println(\"fixed ✓ \" + int.to_string(n))\n}\n"],
    ])})`);
    await ev(`pg.click("AI assistant")`);
    assert(!(await ev(`!!pg.find("Prompt")`)), "the prompt waits for a key");
    await ev(`pg.click("API key")`);
    await ev(`pg.type("sk-ant-test")`);
    await ev(`pg.click("Done")`);
    assert(!(await ev(`!!pg.find("AI key and model")`)), "the key card closes");
    await ev(`pg.type("print the answer")`);
    await ev(`pg.key(1)`);
    await until(`(pg) => pg.texts().some((t) => t.startsWith("Repaired (1)"))`, 90000);
    const out = await ev(`pg.value("Program output")`) ?? "";
    const calls = await ev(`window.aiCalls`);
    assert(calls.length === 2, `expected 2 AI calls, got ${calls.length}`);
    assert(calls[0].headers["x-api-key"] === "sk-ant-test", "key header");
    assert(calls[0].body.system.includes("Almide"), "system prompt");
    assert(calls[0].body.messages[0].content === "print the answer", "prompt");
    assert(/Compile error/.test(calls[1].body.messages.at(-1).content), "repair carries the compile error");
    assert(!calls[1].body.messages[1].content.includes(fence), "fences stripped from history");
    const code = await ev(`pg.value("Code editor")`);
    assert(code.includes("fixed ✓"), `code is ${JSON.stringify(code)}`);
    assert(await ev(`atob(localStorage.getItem("almide-playground:secret:ai-key-0") || "") === "sk-ant-test"`), "key not in secret storage");
    assert(!(await ev(`JSON.stringify(pg.nodes()).includes("sk-ant-test")`)), "key leaked into the a11y tree");
    // the conversation: the request, the error, the fix with its diff, the run
    const t = await ev(`pg.texts()`);
    for (const want of ["print the answer", "Fixed — compiled and ran"]) assert(t.includes(want), `conversation lacks ${want}: ${JSON.stringify(t)}`);
    assert(t.some((x) => x.startsWith("Fix 1/3 · +")), `no fix line: ${JSON.stringify(t)}`);
    await shot("ai");
    void out;
  });

  await step("AI: a follow-up changes the program on screen", async () => {
    await ev(`pg.mockAI(${JSON.stringify([["effect fn main() -> Unit = println(\"forty-three\")\n"]])})`);
    await ev(`pg.click("Prompt")`);
    await ev(`pg.type("print forty-three instead")`);
    await ev(`pg.key(1)`);
    await until(`(pg) => pg.texts().some((t) => t.startsWith("Changed the program")) && pg.texts().filter((t) => t === "Compiled and ran" || t === "Fixed — compiled and ran").length >= 2`, 90000);
    const calls = await ev(`window.aiCalls`);
    const msg = calls.at(-1).body.messages;
    assert(msg.length === 1 && msg[0].content.includes("Here is my current Almide program") && msg[0].content.includes("fixed ✓"), "the follow-up carries the current code");
    await ev(`pg.click("New conversation")`);
    assert(!(await ev(`pg.texts()`)).includes("print the answer"), "New clears the conversation");
    await shot("ai-followup");
  });

  await step("AI: stop while streaming, then fix a failed run", async () => {
    await ev(`pg.mockAI(${JSON.stringify(["hang", ['effect fn main() -> Unit = println("repaired")\n']])})`);
    await ev(`pg.click("Prompt")`);
    await ev(`pg.type("anything")`);
    await ev(`pg.key(1)`);
    await until(`(pg) => !!pg.find("Stop AI")`);
    await ev(`pg.click("Stop AI")`);
    await until(`(pg) => pg.texts().includes("Stopped")`);
    await setCode('effect fn main() -> Unit = println(undefined_thing)\n');
    await ev(`pg.click("Run")`);
    await until(`(pg) => !!pg.find("Fix with AI")`, 60000);
    await ev(`pg.click("Fix with AI")`);
    await until(`(pg) => pg.texts().some((t) => t.startsWith("Repaired (1)"))`, 90000);
    assert((await ev(`pg.value("Code editor")`)).includes("repaired"), "fix not applied");
  });

  await step("every example runs through the UI (Run → output → Visual)", async () => {
    const manifest = JSON.parse(readFileSync(join(root, "apps/playground/assets/examples/manifest.json"), "utf8"));
    const slow = [];
    for (const cat of manifest.categories) {
      if (cat.id === "gui") continue;
      for (const ex of cat.examples) {
        await page.goto(`${url}/tests/e2e/web.html`);
        await ev(`pg.boot({ launch: ${JSON.stringify("https://x.test/?example=" + ex.id)} })`, 120000);
        const t0 = Date.now();
        await ev(`pg.click("Run")`);
        const st = await until(`(pg) => pg.texts().find((t) => t.startsWith("Exited") || t.endsWith("error") || t === "Stopped")`, 60000).catch((e) => { throw new Error(`${ex.id}: ${e.message.slice(0, 120)}`); });
        assert(st === "Exited 0", `${ex.id}: ${st}`);
        assert((await ev("pg.errors()")).length === 0, `${ex.id}: host error ${await ev("pg.errors()")}`);
        const ms = Date.now() - t0;
        if (ms > 5000) slow.push(`${ex.id} ${ms} ms`);
      }
    }
    assert(slow.length === 0, `slow: ${slow.join(", ")}`);
  });

  await step("user GUI: the Todo example runs in the Visual pane, takes input, stops", async () => {
    await page.goto(`${url}/tests/e2e/web.html`);
    await ev(`pg.boot({ width: 1200, height: 760 })`, 120000);
    await ev(`pg.click("Examples")`);
    await ev(`pg.clickIn("Examples menu", "Todo app")`);
    await ev(`pg.click("Run")`);
    await until(`(pg) => pg.texts().includes("Running (window)") || pg.texts().includes("Runtime error")`, 120000);
    if (await ev(`pg.texts().includes("Runtime error")`)) throw new Error(await ev(`pg.value("Program output")`));
    const gui = () => ev(`pg.gui()`);
    await until(`(pg) => { const g = pg.gui(); return (g && g.nodes.some((n) => n.label === "New task")) || pg.texts().includes("Runtime error"); }`, 60000);
    if (await ev(`pg.texts().includes("Runtime error")`)) { await ev(`pg.click("Output")`); throw new Error("program failed: " + (await ev(`pg.value("Program output")`))); }
    let g = await gui();
    assert(g.w > 300 && g.h > 300, `window ${g.w}x${g.h}`);
    const at = (label) => { const n = g.nodes.find((m) => m.label === label); if (!n) throw new Error(`no ${label} in ${g.nodes.map((m) => m.label)}`); return [g.x + n.x + n.w / 2, g.y + n.y + n.h / 2]; };
    const click = async ([x, y]) => {
      for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mousePressed" ? 1 : 0, clickCount: 1 });
    };
    // type a task and press Enter (real input events through the page)
    await click(at("New task"));
    await page.send("Input.insertText", { text: "Buy milk 牛乳" });
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await until(`(pg) => pg.gui()?.nodes.some((n) => n.label === "Buy milk 牛乳")`, 20000);
    await until(`(pg) => pg.gui()?.nodes.some((n) => n.label === "2 tasks left")`, 20000);
    // toggle it, then remove the first task
    g = await gui();
    await click(at("Buy milk 牛乳"));
    await until(`(pg) => pg.gui()?.nodes.some((n) => n.label === "1 task left")`, 20000);
    g = await gui();
    await click(at("Remove Try the playground"));
    await until(`(pg) => !pg.gui()?.nodes.some((n) => n.label === "Try the playground")`, 20000);
    writeFileSync(join(out, "gui-todo.png"), await page.screenshot());
    // Stop tears the program down
    await ev(`pg.click("Stop")`);
    await until(`(pg) => pg.texts().includes("Stopped") && pg.gui() === null`, 20000);
    assert(await ev(`document.querySelectorAll("canvas").length === 0`), "program canvas left behind");
  });

  const errs = await ev("pg.errors()");
  if (errs.length) { failed++; console.log("host errors:\n" + errs.join("\n")); }
} finally {
  if (failed) console.log(page.logs.slice(-40).join("\n"));
  await page.close();
  server.close();
}
process.exit(failed ? 1 : 0);
