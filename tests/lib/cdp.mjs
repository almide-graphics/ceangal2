// Minimal Chrome DevTools Protocol client for the browser tests.
// Real-time waits (no virtual time): wasm compilation and WebGPU need it.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome not found; set CHROME_PATH");
  return found;
}

export async function launch({ port = 9300 + Math.floor(Math.random() * 500), width = 1200, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "ceangal-cdp-"));
  const args = [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--force-device-scale-factor=1",
    "--hide-scrollbars",
    "--no-first-run",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    ...(process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(" ") : []),
    "about:blank",
  ];
  const proc = spawn(chromePath(), args, { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === "page");
    } catch {}
  }
  if (!target) { proc.kill(); throw new Error("Chrome did not open CDP"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send("Runtime.enable");
  await send("Page.enable");
  const logs = [];
  listeners.push((m) => {
    if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
    if (m.method === "Runtime.exceptionThrown") logs.push("EXCEPTION " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  return {
    logs,
    send,
    async goto(url) {
      const loaded = new Promise((r) => listeners.push((m) => m.method === "Page.loadEventFired" && r()));
      await send("Page.navigate", { url });
      await loaded;
    },
    async eval(expr, timeoutMs = 60000) {
      const r = await Promise.race([
        send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }),
        sleep(timeoutMs).then(() => { throw new Error(`eval timed out: ${expr.slice(0, 80)}`); }),
      ]);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async screenshot() {
      const r = await send("Page.captureScreenshot", { format: "png" });
      return Buffer.from(r.data, "base64");
    },
    async close() {
      try { ws.close(); } catch {}
      proc.kill();
      await sleep(200);
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    },
  };
}
