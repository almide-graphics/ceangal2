// A user GUI program (a ceangal app the playground compiled) running in its
// own Worker: own GPUDevice, an OffscreenCanvas, and an in-memory storage
// sandbox. DOM work (events, IME, ARIA, cursor…) stays on the page: requests
// go out as { t: "ui", op, args } and input comes back as { t: "ev", … }.
// See gui.js for the page side and docs/abi.md §5.
import { Host, gpuDevice } from "./host.js";

const post = (m, transfer) => self.postMessage(m, transfer || []);
let host = null;

// The DomUi surface, forwarded to the page.
class RemoteUi {
  constructor(size, apple) { this.size = size; this.apple = apple; }
  measure() { return this.size; }
  attach() {}
  destroy() {}
  imeBegin(...a) { post({ t: "ui", op: "imeBegin", args: a }); }
  imePlace(...a) { post({ t: "ui", op: "imePlace", args: a }); }
  imeEnd() { post({ t: "ui", op: "imeEnd", args: [] }); }
  a11y(nodes, focus) { post({ t: "ui", op: "a11y", args: [nodes, focus] }); }
  cursor(k) { post({ t: "ui", op: "cursor", args: [k] }); }
  title() {}
  location() {}
  openUrl(s) { post({ t: "ui", op: "openUrl", args: [s] }); }
  clipboard(s) { post({ t: "ui", op: "clipboard", args: [s] }); }
  fileSave(id, name, bytes) { post({ t: "ui", op: "fileSave", args: [id, name, bytes] }); }
  fileOpen(id, kind) { post({ t: "ui", op: "fileOpen", args: [id, kind] }); }
}

// Resource limits for untrusted programs.
const MAX_HANDLES = 20000;
const MAX_TEXTURE = 8192;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.t === "start") {
      const device = await gpuDevice();
      device.lost.then((info) => post({ t: "error", message: `GPU device lost: ${info.message}` }));
      const ui = new RemoteUi({ width: m.width, height: m.height, scale: m.scale }, m.apple);
      host = new Host({
        device, canvas: m.canvas, headless: null, appId: "user", ui,
        onError: (err) => post({ t: "error", message: String(err && err.message || err) }),
        stdout: (fd, text) => { for (const line of text.split("\n")) post({ t: fd === 2 ? "stderr" : "stdout", line }); },
      });
      const put = host.put.bind(host);
      host.put = (obj) => {
        if (host.handles.length - host.free.length > MAX_HANDLES) throw new Error(`resource limit: more than ${MAX_HANDLES} GPU objects`);
        if (obj && obj.kind === "texture" && (obj.texture?.width > MAX_TEXTURE || obj.texture?.height > MAX_TEXTURE)) throw new Error(`resource limit: texture larger than ${MAX_TEXTURE}px`);
        return put(obj);
      };
      for (const [name, bytes] of Object.entries(m.assets || {})) host.assets.set(name, bytes);
      await host.instantiate(m.wasm);
      const exitWatch = setInterval(() => { if (host.dead) { clearInterval(exitWatch); post({ t: "exit", code: 0 }); } }, 100);
      host.boot();
      post({ t: "started" });
    } else if (m.t === "ev") {
      if (!host) return;
      const run = () => host.dispatch(...m.args);
      if (m.data) host.withEvent(m.data, run); else run();
      host.schedule();
    } else if (m.t === "resize") {
      host?.resize(m.width, m.height, m.scale);
    } else if (m.t === "deliver") {
      host?.deliver(m.id, m.status, m.body);
    } else if (m.t === "ping") {
      post({ t: "pong", n: m.n });
    }
  } catch (err) {
    post({ t: "error", message: String(err && err.stack || err) });
  }
};
