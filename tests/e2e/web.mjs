// Web E2E for the playground: builds dist/web (unless SKIP_BUILD), opens it
// in headless Chrome with WebGPU, and exercises every feature through the
// accessibility tree. Screenshots land in out/e2e/.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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
    for (const l of ["Run", "Examples", "Share", "main.almd", "Output", "Visual", "Rust", "AST", "New file"]) assert(await ev(`!!pg.find(${JSON.stringify(l)})`), `missing ${l}`);
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

  await step("share copies a link", async () => {
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
    await ev(`pg.click("Output")`);
    await until(`(pg) => !!pg.find("Program output")`);
    await shot("mobile-output");
  });

  const errs = await ev("pg.errors()");
  if (errs.length) { failed++; console.log("host errors:\n" + errs.join("\n")); }
} finally {
  if (failed) console.log(page.logs.slice(-40).join("\n"));
  await page.close();
  server.close();
}
process.exit(failed ? 1 : 0);
