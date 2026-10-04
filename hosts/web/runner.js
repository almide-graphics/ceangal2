// The `runner` namespace for the web host: the playground's compiler
// service (apps/playground/docs/runner.md) backed by runner-worker.js.
//
//   start({ ..., extensions: [runnerExtension({ compiler: "compiler/almide_compiler_service.js" })] })
//
// Results reach the guest as event 10 (RESULT) with these statuses:
//   check: 200 diagnostics JSON
//   run:   100 stdout line, 101 stderr line, 102 compiled (ms), 103 GUI
//          program started (it runs in a GuiSession until it exits or Stop),
//          200 done {exitCode, compileMs, runMs}, 500 error {phase, error}
//   rust / ast: 200 text, 500 error {phase, error}
// A run with no result within `timeoutMs` is stopped and reported as 500.

import { GuiSession } from "./gui.js";

const enc = new TextEncoder();

export function runnerExtension({ compiler = "./compiler/almide_compiler_service.js", timeoutMs = 20000, workerUrl } = {}) {
  return (host) => {
    const url = workerUrl || new URL("./runner-worker.js", import.meta.url);
    const workerSrc = new URL(url);
    workerSrc.searchParams.set("compiler", new URL(compiler, import.meta.url).href);
    let worker = null;
    let version = "";
    const pending = new Map(); // id -> {timer}
    const guis = new Map();    // id -> GuiSession
    let guiRect = [0, 0, 0, 0];
    const deliver = (id, status, body) => host.deliver(id, status, typeof body === "string" ? enc.encode(body) : body);

    function spawn() {
      worker = new Worker(workerSrc, { type: "module" });
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.id === 0) { version = m.version || ""; return; }
        if (!pending.has(m.id)) return;
        if (m.event === "stdout") return deliver(m.id, 100, m.line);
        if (m.event === "stderr") return deliver(m.id, 101, m.line);
        if (m.event === "compiled") return deliver(m.id, 102, String(Math.round(m.ms)));
        if (m.event === "gui") return startGui(m.id, m.wasm, m.compileMs);
        if (!m.done) return;
        clearTimeout(pending.get(m.id).timer);
        pending.delete(m.id);
        if (!m.ok) return deliver(m.id, 500, JSON.stringify({ phase: m.phase, error: m.error }));
        if (m.diagnostics != null) return deliver(m.id, 200, m.diagnostics);
        if (m.code != null) return deliver(m.id, 200, m.code);
        if (m.ast != null) return deliver(m.id, 200, m.ast);
        deliver(m.id, 200, JSON.stringify({ exitCode: m.exitCode, compileMs: m.compileMs, runMs: m.runMs }));
      };
      worker.onerror = (e) => {
        for (const [id, p] of pending) { clearTimeout(p.timer); deliver(id, 500, JSON.stringify({ phase: "worker", error: e.message || "worker crashed" })); }
        pending.clear();
      };
      worker.postMessage({ id: 0, op: "version" });
    }
    spawn();

    function startGui(id, wasm, compileMs) {
      clearTimeout(pending.get(id).timer);
      pending.delete(id);
      for (const [other, g] of guis) { g.stop(); guis.delete(other); }
      const fonts = {};
      for (const [name, bytes] of host.assets) if (name.startsWith("fonts/")) fonts[name] = bytes;
      const t0 = performance.now();
      const done = (status, body) => { if (guis.delete(id)) deliver(id, status, body); };
      const g = new GuiSession({
        wasm, assets: fonts,
        onStdout: (line, err) => deliver(id, err ? 101 : 100, line),
        onExit: (code) => done(200, JSON.stringify({ exitCode: code, compileMs, runMs: performance.now() - t0 })),
        onError: (message) => done(500, JSON.stringify({ phase: "runtime", error: message })),
        onHang: (s) => deliver(id, 101, `The program has not answered for ${s} s (an endless loop?). Stop ends it.`),
      });
      guis.set(id, g);
      deliver(id, 103, "");
      place();
    }

    function place() {
      const r = host.ui.canvas?.getBoundingClientRect?.() || { left: 0, top: 0 };
      const [x, y, w, h] = guiRect;
      for (const g of guis.values()) g.place(r.left + x, r.top + y, w, h);
    }

    // Kill the worker (and every in-flight request with it) and start a fresh one.
    function restart(reason) {
      worker.terminate();
      for (const [id, p] of pending) { clearTimeout(p.timer); deliver(id, 500, JSON.stringify({ phase: "stopped", error: reason })); }
      pending.clear();
      spawn();
    }

    function request(msg, timeout) {
      const id = host.nextRequest++;
      const timer = timeout ? setTimeout(() => { if (pending.has(id)) restart(`timed out after ${timeout / 1000}s`); }, timeout) : null;
      pending.set(id, { timer });
      worker.postMessage({ ...msg, id });
      return BigInt(id);
    }

    const files = (p, n) => JSON.parse(host.str(p, n));
    host.guiSessions = guis;   // tests read the running program's a11y tree
    return {
      runner: {
        runner_version_len: () => BigInt(enc.encode(version).length),
        runner_version_read: (p, n) => host.fill(enc.encode(version), p, n),
        runner_check: (fp, fn, ep, en) => request({ op: "check", files: files(fp, fn), entry: host.str(ep, en) }, 0),
        runner_run: (fp, fn, ep, en) => request({ op: "run", files: files(fp, fn), entry: host.str(ep, en) }, timeoutMs),
        runner_rust: (fp, fn, ep, en) => request({ op: "rust", files: files(fp, fn), entry: host.str(ep, en) }, 0),
        runner_ast: (sp, sn) => request({ op: "ast", source: host.str(sp, sn) }, 0),
        runner_stop: (id) => {
          const g = guis.get(Number(id));
          if (g) { g.stop(); guis.delete(Number(id)); deliver(Number(id), 500, JSON.stringify({ phase: "stopped", error: "stopped" })); }
          else if (pending.has(Number(id))) restart("stopped");
        },
        runner_gui_place: (x, y, w, h) => { guiRect = [x, y, w, h]; place(); },
      },
    };
  };
}
