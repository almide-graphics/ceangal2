// The page side of a user GUI program: an overlay <canvas> handed to a Worker
// (gui-worker.js) as an OffscreenCanvas, with a DomUi translating DOM input
// into ABI events for it. The playground places the overlay where its Visual
// pane is (runner_gui_place) and tears the session down on Stop.
import { DomUi, appleOS } from "./dom.js";

export class GuiSession {
  // wasm: Uint8Array; assets: { name: Uint8Array } (fonts); callbacks:
  // onStdout(line, isErr), onExit(code), onError(message), onHang(seconds).
  constructor({ wasm, assets, onStdout, onExit, onError, onHang }) {
    this.cb = { onStdout, onExit, onError, onHang };
    this.ended = false;
    const c = (this.canvas = document.createElement("canvas"));
    Object.assign(c.style, { position: "fixed", left: "0px", top: "0px", width: "1px", height: "1px", display: "none", zIndex: "10", outline: "none" });
    c.setAttribute("aria-label", "Program window");
    document.body.appendChild(c);
    this.worker = new Worker(new URL("./gui-worker.js", import.meta.url), { type: "module" });
    this.pendingData = null;
    const self = this;
    // The DomUi target: forward everything to the worker.
    this.proxy = {
      dispatch: (...args) => { self.post({ t: "ev", args, data: self.pendingData }); return 1; },
      withEvent: (data, f) => { self.pendingData = data; try { return f(); } finally { self.pendingData = null; } },
      schedule: () => {},
      deliver: (id, status, body) => self.post({ t: "deliver", id, status, body }),
      resize: (width, height, scale) => self.post({ t: "resize", width, height, scale }),
    };
    this.ui = new DomUi(c, this.proxy);
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.fail(e.message || "worker error");
    this.started = false;
    this.wasm = wasm;
    this.assets = assets;
    this.lastPong = performance.now();
    this.pingN = 0;
    this.watchdog = setInterval(() => this.tick(), 1000);
  }

  post(m, transfer) { if (!this.ended) this.worker.postMessage(m, transfer || []); }

  // Place the program window (page px). A zero size hides it.
  place(x, y, w, h) {
    const c = this.canvas;
    if (w <= 1 || h <= 1) { c.style.display = "none"; return; }
    Object.assign(c.style, { display: "block", left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    if (!this.started) this.start();
  }

  start() {
    this.started = true;
    const m = this.ui.measure();
    const off = this.canvas.transferControlToOffscreen();
    off.width = Math.ceil(m.width * m.scale);
    off.height = Math.ceil(m.height * m.scale);
    this.post({ t: "start", canvas: off, wasm: this.wasm, assets: this.assets, width: m.width, height: m.height, scale: m.scale, apple: appleOS() }, [off]);
    this.ui.attach();
  }

  onMessage(m) {
    if (m.t === "ui") this.ui[m.op]?.(...m.args);
    else if (m.t === "stdout" || m.t === "stderr") this.cb.onStdout?.(m.line, m.t === "stderr");
    else if (m.t === "pong") this.lastPong = performance.now();
    else if (m.t === "exit") this.end(() => this.cb.onExit?.(m.code));
    else if (m.t === "error") this.fail(m.message);
  }

  // A program stuck in a loop stops answering pings; say so (Stop still works).
  tick() {
    if (!this.started || this.ended) return;
    const silent = (performance.now() - this.lastPong) / 1000;
    if (silent > 5 && !this.hangReported) { this.hangReported = true; this.cb.onHang?.(Math.round(silent)); }
    this.post({ t: "ping", n: ++this.pingN });
  }

  fail(message) { this.end(() => this.cb.onError?.(message)); }

  end(report) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.watchdog);
    this.worker.terminate();
    this.ui.destroy();
    this.canvas.remove();
    report?.();
  }

  // Stop: tear the program down; its GPU device and memory go with the worker.
  stop() { this.end(); }

  // Accessibility nodes the program last committed (tests read them).
  get nodes() { return this.ui.lastNodes || []; }
}
