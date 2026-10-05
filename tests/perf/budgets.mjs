// Size and startup budgets for apps' web builds: the wasm (what every
// visitor downloads before the first frame) and the time from opening the
// page to the app's first accessible frame in headless Chrome (median of
// three loads). A change that blows a budget fails CI; raise the number in
// tests/perf/budgets.json only with a reason in the commit.
//   node tests/perf/budgets.mjs <name>=<web dir>…
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch } from "../lib/cdp.mjs";
import { serve } from "../lib/serve.mjs";

const budgets = JSON.parse(readFileSync(new URL("./budgets.json", import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
for (const arg of process.argv.slice(2)) {
  const [name, dir] = arg.split("=");
  const b = budgets.apps[name];
  if (!b) { console.log(`FAIL ${name}: no budget in tests/perf/budgets.json`); failed++; continue; }
  const wasm = readdirSync(dir).find((f) => f.endsWith(".wasm"));
  const kb = statSync(join(dir, wasm)).size / 1024;
  const sizeOk = kb <= b.wasm_kb;
  console.log(`${sizeOk ? "ok  " : "FAIL"} ${name}: ${wasm} ${kb.toFixed(1)} KB (budget ${b.wasm_kb} KB)`);
  if (!sizeOk) failed++;

  const server = await serve(resolve(dir));
  const times = [];
  for (let i = 0; i < 3; i++) {
    const page = await launch({ width: 480, height: 800 });
    const t0 = Date.now();
    await page.send("Page.navigate", { url: `${server.url}/index.html` });
    let ms = null;
    while (Date.now() - t0 < 30000) {
      const n = await page.eval(`document.querySelectorAll("[data-ceangal-a11y] [aria-label]").length`).catch(() => 0);
      if (n > 0) { ms = Date.now() - t0; break; }
      await sleep(10);
    }
    await page.close();
    times.push(ms ?? 30000);
  }
  server.server.close();
  const median = times.sort((a, b) => a - b)[1];
  const startOk = median <= budgets.startup_ms;
  console.log(`${startOk ? "ok  " : "FAIL"} ${name}: first frame in ${median} ms (median of ${times.join(", ")}; budget ${budgets.startup_ms} ms)`);
  if (!startOk) failed++;
}
process.exit(failed ? 1 : 0);
