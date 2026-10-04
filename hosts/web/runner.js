// The `runner` namespace for the web host: the playground's compiler
// service (apps/playground/docs/runner.md) backed by runner-worker.js.
//
//   start({ ..., extensions: [runnerExtension({ compiler: "compiler/almide_compiler_service.js" })] })
//
// Results reach the guest as event 10 (RESULT) with these statuses:
//   check: 200 diagnostics JSON
//   run:   100 stdout line, 101 stderr line, 102 compiled (ms),
//          200 done {exitCode, compileMs, runMs}, 500 error {phase, error}
//   rust / ast: 200 text, 500 error {phase, error}
// A run with no result within `timeoutMs` is stopped and reported as 500.

const enc = new TextEncoder();

export function runnerExtension({ compiler = "./compiler/almide_compiler_service.js", timeoutMs = 20000, workerUrl } = {}) {
  return (host) => {
    const url = workerUrl || new URL("./runner-worker.js", import.meta.url);
    const workerSrc = new URL(url);
    workerSrc.searchParams.set("compiler", new URL(compiler, import.meta.url).href);
    let worker = null;
    let version = "";
    const pending = new Map(); // id -> {timer}
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
    return {
      runner: {
        runner_version_len: () => BigInt(enc.encode(version).length),
        runner_version_read: (p, n) => host.fill(enc.encode(version), p, n),
        runner_check: (fp, fn, ep, en) => request({ op: "check", files: files(fp, fn), entry: host.str(ep, en) }, 0),
        runner_run: (fp, fn, ep, en) => request({ op: "run", files: files(fp, fn), entry: host.str(ep, en) }, timeoutMs),
        runner_rust: (fp, fn, ep, en) => request({ op: "rust", files: files(fp, fn), entry: host.str(ep, en) }, 0),
        runner_ast: (sp, sn) => request({ op: "ast", source: host.str(sp, sn) }, 0),
        runner_stop: (id) => { if (pending.has(Number(id))) restart("stopped"); },
      },
    };
  };
}
