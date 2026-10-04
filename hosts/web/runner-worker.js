// The playground's compiler service in a Worker: compile with the Almide
// compiler (wasm), then run the program under a WASI preview-1 shim. An
// infinite loop or a heavy compile never blocks the UI thread; Stop is
// worker.terminate() + respawn (runner.js).
//
// Messages (all carry `id`):
//   → { id, op: 'version' }                  ← { id, done, ok, version }
//   → { id, op: 'check', files, entry }      ← { id, done, ok, diagnostics }  (JSON text)
//   → { id, op: 'rust',  files, entry }      ← { id, done, ok, code }
//   → { id, op: 'ast',   source }            ← { id, done, ok, ast }
//   → { id, op: 'run',   files, entry }      ← { id, event: 'compiled', ms }
//                                            ← { id, event: 'stdout'|'stderr', line }
//                                            ← { id, done, ok, exitCode, compileMs, runMs }
//   any failure                              ← { id, done, ok: false, phase, error }

import { WASI, File, OpenFile, PreopenDirectory, ConsoleStdout } from "./vendor/browser_wasi_shim/index.js";

const params = new URL(self.location.href).searchParams;
const compilerUrl = params.get("compiler") || "./compiler/almide_compiler_service.js";
const ready = import(compilerUrl).then(async (m) => { await m.default(); return m; });

const STDIN_TAB = "stdin.txt";
const post = (msg) => self.postMessage(msg);

function dataFileEntries(files) {
  const enc = new TextEncoder();
  const entries = new Map();
  for (const [name, content] of Object.entries(files)) {
    if (name.endsWith(".almd") || name === STDIN_TAB) continue;
    entries.set(name, new File(enc.encode(content)));
  }
  return entries;
}

async function runWasm(id, bytes, files) {
  const stdin = new TextEncoder().encode(files[STDIN_TAB] ?? "");
  const fds = [
    new OpenFile(new File(stdin)),
    ConsoleStdout.lineBuffered((line) => post({ id, event: "stdout", line })),
    ConsoleStdout.lineBuffered((line) => post({ id, event: "stderr", line })),
    new PreopenDirectory(".", dataFileEntries(files)),
  ];
  const wasi = new WASI([], [], fds);
  const module = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
  return wasi.start(instance);
}

self.onmessage = async (e) => {
  const msg = e.data;
  const { id, op } = msg;
  let c;
  try { c = await ready; } catch (err) { post({ id, done: true, ok: false, phase: "boot", error: "compiler load failed: " + err }); return; }
  try {
    if (op === "version") post({ id, done: true, ok: true, version: c.get_version_info() });
    else if (op === "check") post({ id, done: true, ok: true, diagnostics: c.check_project(JSON.stringify(msg.files), msg.entry) });
    else if (op === "rust") {
      try { post({ id, done: true, ok: true, code: c.compile_project_to_rust(JSON.stringify(msg.files), msg.entry) }); }
      catch (err) { post({ id, done: true, ok: false, phase: "compile", error: String(err) }); }
    } else if (op === "ast") {
      try { post({ id, done: true, ok: true, ast: c.parse_to_ast(msg.source) }); }
      catch (err) { post({ id, done: true, ok: false, phase: "parse", error: String(err) }); }
    } else if (op === "run") {
      const t0 = performance.now();
      let bytes;
      try { bytes = c.compile_project_to_wasm(JSON.stringify(msg.files), msg.entry); }
      catch (err) { post({ id, done: true, ok: false, phase: "compile", error: String(err) }); return; }
      const compileMs = performance.now() - t0;
      post({ id, event: "compiled", ms: compileMs });
      const t1 = performance.now();
      try {
        const exitCode = await runWasm(id, bytes, msg.files);
        post({ id, done: true, ok: true, exitCode: exitCode ?? 0, compileMs, runMs: performance.now() - t1 });
      } catch (err) {
        post({ id, done: true, ok: false, phase: "runtime", error: String(err), compileMs });
      }
    } else post({ id, done: true, ok: false, phase: "protocol", error: "unknown op " + op });
  } catch (err) {
    post({ id, done: true, ok: false, phase: op, error: String(err) });
  }
};
