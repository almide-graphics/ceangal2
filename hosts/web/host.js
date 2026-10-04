// ceangal2 web host — implements docs/abi.md for a wasm guest in a browser.
//
//   import { start } from "./host.js";
//   const app = await start({ canvas, wasm: "app.wasm", assets: { "fonts/ui.ttf": url } });
//
// Rendering is WebGPU only. Text input, IME and screen readers go through an
// invisible textarea and an ARIA overlay; every visible pixel comes from the
// guest via snaidhm.

const EV = { INIT: 1, RESIZE: 2, FRAME: 3, POINTER: 4, WHEEL: 5, KEY: 6, TEXT: 7, FOCUS: 8, LIFECYCLE: 9, RESULT: 10, APPEARANCE: 11, A11Y: 12 };

const KEYS = {
  Enter: 1, Tab: 2, Backspace: 3, Delete: 4, Escape: 5,
  ArrowLeft: 10, ArrowRight: 11, ArrowUp: 12, ArrowDown: 13, Home: 14, End: 15, PageUp: 16, PageDown: 17,
  F1: 40, F2: 41, F3: 42, F4: 43, F5: 44, F6: 45, F7: 46, F8: 47, F9: 48, F10: 49, F11: 50, F12: 51,
};
const LETTER_KEYS = { a: 20, c: 21, v: 22, x: 23, z: 24, y: 25, s: 26, f: 27, o: 28, n: 29, w: 30 };
const CURSORS = ["default", "text", "pointer", "grab", "ew-resize", "ns-resize"];
const ROLES = { 1: "application", 2: "group", 3: "button", 4: "note", 5: "textbox", 6: "list", 7: "listitem", 8: "tab", 9: "tablist", 10: "heading", 11: "link", 12: "checkbox", 13: "img", 14: "textbox" };

const enc = new TextEncoder();
const dec = new TextDecoder();

function modsOf(e) {
  return (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
}

export class UnsupportedError extends Error {}

export async function start(opts) {
  const { canvas, wasm, assets = {}, headless = null, appId = "ceangal" } = opts;
  if (!navigator.gpu) throw new UnsupportedError("WebGPU is not available in this browser");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
  if (!adapter) throw new UnsupportedError("No WebGPU adapter");
  const device = await adapter.requestDevice();
  const host = new Host({ device, canvas, headless, appId, onError: opts.onError });
  await host.loadAssets(assets);
  await host.instantiate(wasm);
  host.boot();
  return host;
}

class Host {
  constructor({ device, canvas, headless, appId, onError }) {
    this.device = device;
    this.canvas = canvas;
    this.headless = headless;
    this.appId = appId;
    this.onError = onError || ((e) => console.error(e));
    this.handles = [null];
    this.free = [];
    this.bindings = [];
    this.encoder = null;
    this.frameTex = null;
    this.eventData = new Uint8Array(0);
    this.assets = new Map();
    this.frameRequested = true;
    this.animating = false;
    this.rafPending = false;
    this.nextRequest = 1;
    this.dead = false;
    if (headless) {
      this.format = "bgra8unorm";
      this.width = headless.width;
      this.height = headless.height;
      this.scale = headless.scale || 1;
      this.offscreen = device.createTexture({
        size: [Math.ceil(this.width * this.scale), Math.ceil(this.height * this.scale)],
        format: this.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
      });
    } else {
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.context = canvas.getContext("webgpu");
      this.context.configure({ device, format: this.format, alphaMode: "opaque" });
    }
  }

  async loadAssets(assets) {
    await Promise.all(Object.entries(assets).map(async ([name, src]) => {
      const data = src instanceof Uint8Array ? src : new Uint8Array(await (await fetch(src)).arrayBuffer());
      this.assets.set(name, data);
    }));
  }

  // ── memory helpers ──
  mem() { return new Uint8Array(this.memory.buffer); }
  bytes(ptr, len) { const p = Number(ptr), n = Number(len); return n > 0 ? this.mem().slice(p, p + n) : new Uint8Array(0); }
  view(ptr, len) { const p = Number(ptr), n = Number(len); return new Uint8Array(this.memory.buffer, p, n); }
  str(ptr, len) { return dec.decode(this.bytes(ptr, len)); }
  fill(src, ptr, len) {
    const n = Math.min(src.length, Number(len));
    if (n > 0) this.mem().set(src.subarray(0, n), Number(ptr));
    return BigInt(n);
  }

  // ── handle table ──
  put(obj) {
    if (this.free.length) { const i = this.free.pop(); this.handles[i] = obj; return BigInt(i); }
    this.handles.push(obj);
    return BigInt(this.handles.length - 1);
  }
  get(h) { const i = Number(h); return i > 0 ? this.handles[i] : null; }
  drop(h) { const i = Number(h); if (i > 0 && this.handles[i] != null) { this.handles[i] = null; this.free.push(i); } }

  imports() {
    const self = this;
    const fmt = (code) => (Number(code) === 2 ? "rgba8unorm" : Number(code) === 3 ? "r8unorm" : "bgra8unorm");
    const gpu = {
      surface_format: () => BigInt(self.format === "rgba8unorm" ? 2 : 1),
      create_shader: (p, n) => {
        const module = self.device.createShaderModule({ code: self.str(p, n) });
        module.getCompilationInfo().then((info) => {
          for (const m of info.messages) if (m.type === "error") self.onError(new Error(`WGSL: ${m.message} (line ${m.lineNum})`));
        });
        return self.put({ kind: "shader", module });
      },
      create_render_pipeline: (shader, vp, vn, fp, fn, format, blend) => {
        const s = self.get(shader);
        if (!s) return 0n;
        const f = Number(format) === 0 ? self.format : fmt(format);
        const premul = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } };
        const pipeline = self.device.createRenderPipeline({
          layout: "auto",
          vertex: { module: s.module, entryPoint: self.str(vp, vn) },
          fragment: { module: s.module, entryPoint: self.str(fp, fn), targets: [{ format: f, blend: Number(blend) === 1 ? premul : undefined }] },
          primitive: { topology: "triangle-list" },
        });
        return self.put({ kind: "pipeline", pipeline });
      },
      create_buffer: (size, usage) => {
        const s = Math.max(4, Math.ceil(Number(size) / 4) * 4);
        return self.put({ kind: "buffer", buffer: self.device.createBuffer({ size: s, usage: Number(usage) }) });
      },
      write_buffer: (b, off, p, n) => {
        const buf = self.get(b);
        if (!buf || Number(n) % 4 !== 0) return;
        self.device.queue.writeBuffer(buf.buffer, Number(off), self.view(p, n));
      },
      create_texture: (w, h, format, usage) => {
        const f = fmt(format);
        const texture = self.device.createTexture({ size: [Math.max(1, Number(w)), Math.max(1, Number(h))], format: f, usage: Number(usage) });
        return self.put({ kind: "texture", texture, view: texture.createView(), format: f });
      },
      write_texture: (t, x, y, w, h, p, n, bpr) => {
        const tex = self.get(t);
        if (!tex || Number(w) <= 0 || Number(h) <= 0) return;
        self.device.queue.writeTexture(
          { texture: tex.texture, origin: [Number(x), Number(y)] },
          self.view(p, n),
          { bytesPerRow: Number(bpr), rowsPerImage: Number(h) },
          [Number(w), Number(h)],
        );
      },
      create_sampler: (filter) => {
        const f = Number(filter) === 1 ? "linear" : "nearest";
        return self.put({ kind: "sampler", sampler: self.device.createSampler({ magFilter: f, minFilter: f }) });
      },
      bind_begin: () => { self.bindings = []; },
      bind_buffer: (binding, h) => { self.bindings.push([Number(binding), h, "buffer"]); },
      bind_texture: (binding, h) => { self.bindings.push([Number(binding), h, "texture"]); },
      bind_sampler: (binding, h) => { self.bindings.push([Number(binding), h, "sampler"]); },
      bind_create: (pipeline, group) => {
        const p = self.get(pipeline);
        if (!p) return 0n;
        const entries = [];
        for (const [binding, h, kind] of self.bindings) {
          const o = self.get(h);
          if (!o) return 0n;
          entries.push({ binding, resource: kind === "buffer" ? { buffer: o.buffer } : kind === "texture" ? o.view : o.sampler });
        }
        self.bindings = [];
        return self.put({ kind: "bind", group: self.device.createBindGroup({ layout: p.pipeline.getBindGroupLayout(Number(group)), entries }) });
      },
      frame_begin: () => {
        let texture;
        if (self.headless) texture = self.offscreen;
        else {
          const w = Math.max(1, Math.round(self.width * self.scale)), h = Math.max(1, Math.round(self.height * self.scale));
          if (self.canvas.width !== w || self.canvas.height !== h) { self.canvas.width = w; self.canvas.height = h; }
          texture = self.context.getCurrentTexture();
        }
        self.encoder = self.device.createCommandEncoder();
        return self.put({ kind: "target", view: texture.createView(), width: texture.width, height: texture.height });
      },
      target_width: (t) => BigInt(self.get(t)?.width ?? 0),
      target_height: (t) => BigInt(self.get(t)?.height ?? 0),
      pass_begin: (t, load, r, g, b, a) => {
        const target = self.get(t);
        if (!target || !self.encoder) return 0n;
        const pass = self.encoder.beginRenderPass({
          colorAttachments: [{ view: target.view, loadOp: Number(load) === 1 ? "load" : "clear", clearValue: { r, g, b, a }, storeOp: "store" }],
        });
        return self.put({ kind: "pass", pass });
      },
      pass_pipeline: (p, pl) => { const pass = self.get(p), o = self.get(pl); if (pass && o) pass.pass.setPipeline(o.pipeline); },
      pass_bind: (p, i, g) => { const pass = self.get(p), o = self.get(g); if (pass && o) pass.pass.setBindGroup(Number(i), o.group); },
      pass_scissor: (p, x, y, w, h) => { self.get(p)?.pass.setScissorRect(Number(x), Number(y), Number(w), Number(h)); },
      pass_draw: (p, v, i, fv, fi) => { self.get(p)?.pass.draw(Number(v), Number(i), Number(fv), Number(fi)); },
      pass_end: (p) => { const pass = self.get(p); if (pass) { pass.pass.end(); self.drop(p); } },
      frame_submit: () => {
        for (let i = 1; i < self.handles.length; i++) {
          const o = self.handles[i];
          if (o && (o.kind === "target" || o.kind === "pass")) { if (o.kind === "pass") o.pass.end(); self.drop(i); }
        }
        if (self.encoder) { self.device.queue.submit([self.encoder.finish()]); self.encoder = null; }
      },
      release: (h) => {
        const o = self.get(h);
        if (!o) return;
        if (o.kind === "buffer") o.buffer.destroy();
        if (o.kind === "texture") o.texture.destroy();
        self.drop(h);
      },
      external_texture: () => 0n,
    };

    const sys = {
      abi_version: () => 1n,
      run: () => {},
      request_frame: () => { self.frameRequested = true; self.schedule(); },
      now_ms: () => performance.now(),
      log: (p, n) => console.log(self.str(p, n)),
      event_len: () => BigInt(self.eventData.length),
      event_read: (p, n) => self.fill(self.eventData, p, n),
      platform: () => 1n,
      set_cursor: (k) => { if (!self.headless) self.canvas.style.cursor = CURSORS[Number(k)] || "default"; },
      set_title: (p, n) => { if (!self.headless) document.title = self.str(p, n); },
      open_url: (p, n) => { window.open(self.str(p, n), "_blank", "noopener"); },
      asset_len: (p, n) => { const a = self.assets.get(self.str(p, n)); return BigInt(a ? a.length : -1); },
      asset_read: (p, n, dp, dn) => { const a = self.assets.get(self.str(p, n)); return a ? self.fill(a, dp, dn) : 0n; },
      exit: () => { self.dead = true; },
    };

    const text_input = {
      ime_begin: (x, y, w, h) => self.imeBegin(x, y, w, h),
      ime_update: (x, y, w, h) => self.imePlace(x, y, w, h),
      ime_end: () => self.imeEnd(),
    };

    const a11y = {
      a11y_begin: () => { self.a11yNodes = []; },
      a11y_node: (id, parent, role, x, y, w, h, flags, lp, ln) => {
        (self.a11yNodes ||= []).push({ id: Number(id), parent: Number(parent), role: Number(role), x, y, w, h, flags: Number(flags), label: self.str(lp, ln) });
      },
      a11y_value: (id, p, n) => {
        const node = (self.a11yNodes || []).findLast((m) => m.id === Number(id));
        if (node) node.value = self.str(p, n);
      },
      a11y_commit: (focus) => self.a11yCommit(Number(focus)),
    };

    const clipboard = {
      clipboard_write: (p, n) => { const s = self.str(p, n); navigator.clipboard?.writeText(s).catch(() => {}); },
    };

    const kv = (prefix) => ({
      len: (kp, kn) => { const v = localStorage.getItem(prefix + self.str(kp, kn)); return BigInt(v == null ? -1 : unb64(v).length); },
      read: (kp, kn, dp, dn) => { const v = localStorage.getItem(prefix + self.str(kp, kn)); return v == null ? 0n : self.fill(unb64(v), dp, dn); },
      write: (kp, kn, p, n) => { try { localStorage.setItem(prefix + self.str(kp, kn), b64(self.bytes(p, n))); } catch {} },
      remove: (kp, kn) => localStorage.removeItem(prefix + self.str(kp, kn)),
    });
    const s1 = kv(`${self.appId}:kv:`), s2 = kv(`${self.appId}:secret:`);
    const storage = {
      storage_len: s1.len, storage_read: s1.read, storage_write: s1.write, storage_remove: s1.remove,
      secret_len: s2.len, secret_read: s2.read, secret_write: s2.write, secret_remove: s2.remove,
    };

    const requests = new Map();
    const net = {
      http_begin: (mp, mn, up, un) => {
        const id = self.nextRequest++;
        requests.set(id, { method: self.str(mp, mn), url: self.str(up, un), headers: {} });
        return BigInt(id);
      },
      http_header: (id, np, nn, vp, vn) => { const r = requests.get(Number(id)); if (r) r.headers[self.str(np, nn)] = self.str(vp, vn); },
      http_send: (id, bp, bn) => {
        const r = requests.get(Number(id));
        if (!r) return;
        requests.delete(Number(id));
        const body = Number(bn) > 0 ? self.bytes(bp, bn) : undefined;
        self.httpRun(Number(id), r, body);
      },
    };

    const file = {
      file_open: (kind) => { const id = self.nextRequest++; self.fileOpen(id, Number(kind)); return BigInt(id); },
      file_save: (np, nn, p, n) => {
        const id = self.nextRequest++;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([self.bytes(p, n)]));
        a.download = self.str(np, nn);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        queueMicrotask(() => self.deliver(id, 200, new Uint8Array(0)));
        return BigInt(id);
      },
    };

    const wasi = {
      fd_write: (fd, iovs, iovsLen, nwritten) => {
        const v = new DataView(self.memory.buffer);
        let total = 0;
        let text = "";
        for (let i = 0; i < iovsLen; i++) {
          const p = v.getUint32(iovs + 8 * i, true), n = v.getUint32(iovs + 8 * i + 4, true);
          text += dec.decode(self.mem().subarray(p, p + n));
          total += n;
        }
        (fd === 2 ? console.error : console.log)(text.replace(/\n$/, ""));
        v.setUint32(nwritten, total, true);
        return 0;
      },
      proc_exit: (code) => { throw new GuestExit(code); },
      random_get: (p, n) => { crypto.getRandomValues(self.mem().subarray(p, p + n)); return 0; },
      clock_time_get: (id, prec, out) => { new DataView(self.memory.buffer).setBigUint64(out, BigInt(Math.round(Date.now() * 1e6)), true); return 0; },
      fd_read: (fd, iovs, iovsLen, nread) => { new DataView(self.memory.buffer).setUint32(nread, 0, true); return 0; },
      environ_sizes_get: (c, s) => { const v = new DataView(self.memory.buffer); v.setUint32(c, 0, true); v.setUint32(s, 0, true); return 0; },
      environ_get: () => 0,
      args_sizes_get: (c, s) => { const v = new DataView(self.memory.buffer); v.setUint32(c, 0, true); v.setUint32(s, 0, true); return 0; },
      args_get: () => 0,
    };
    const wasiProxy = new Proxy(wasi, { get: (t, k) => t[k] || (() => 52 /* ENOSYS */) });
    return { gpu, sys, text_input, a11y, clipboard, storage, net, file, wasi_snapshot_preview1: wasiProxy };
  }

  async instantiate(wasm) {
    const source = typeof wasm === "string" ? fetch(wasm) : wasm;
    const res = source instanceof Promise || source instanceof Response ? await source : source;
    const imports = this.imports();
    const { instance } = res instanceof Response
      ? await WebAssembly.instantiateStreaming(res, imports).catch(async () => WebAssembly.instantiate(await (await fetch(wasm)).arrayBuffer(), imports))
      : await WebAssembly.instantiate(res, imports);
    this.instance = instance;
    this.memory = instance.exports.memory;
    if (typeof instance.exports.ceangal_event !== "function") throw new Error("guest does not export ceangal_event (see docs/abi.md §2)");
  }

  dispatch(kind, a = 0, b = 0, x = 0, y = 0, z = 0, w = 0) {
    if (this.dead) return 0;
    try {
      return Number(this.instance.exports.ceangal_event(BigInt(kind), BigInt(a), BigInt(b), x, y, z, w));
    } catch (e) {
      if (e instanceof GuestExit) { this.dead = true; return 0; }
      this.dead = true;
      this.onError(e);
      return 0;
    }
  }

  withEvent(data, f) {
    this.eventData = data;
    try { return f(); } finally { this.eventData = new Uint8Array(0); }
  }

  boot() {
    try { this.instance.exports._start?.(); } catch (e) { if (!(e instanceof GuestExit)) throw e; }
    if (!this.headless) {
      this.measure();
      this.attachEvents();
    }
    this.dispatch(EV.INIT, 0, 0, this.width, this.height, this.scale);
    this.schedule();
  }

  measure() {
    const r = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.scale = window.devicePixelRatio || 1;
  }

  schedule() {
    if (this.headless || this.rafPending || this.dead) return;
    if (!this.frameRequested && !this.animating) return;
    this.rafPending = true;
    requestAnimationFrame((t) => {
      this.rafPending = false;
      this.frameRequested = false;
      this.animating = this.dispatch(EV.FRAME, 0, 0, t) === 1;
      this.schedule();
    });
  }

  // Headless: render frames until settled, then read the target back as RGBA.
  async settle(maxFrames = 8) {
    for (let i = 0; i < maxFrames; i++) {
      const wanted = this.frameRequested;
      this.frameRequested = false;
      const again = this.dispatch(EV.FRAME, 0, 0, i * 16) === 1;
      if (!wanted && !again) break;
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  async snapshot() {
    await this.settle();
    const tex = this.offscreen;
    const w = tex.width, h = tex.height, padded = Math.ceil((w * 4) / 256) * 256;
    const buf = this.device.createBuffer({ size: padded * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const e = this.device.createCommandEncoder();
    e.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: padded, rowsPerImage: h }, [w, h]);
    this.device.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = y * padded + x * 4, d = (y * w + x) * 4;
        out[d] = src[s + 2]; out[d + 1] = src[s + 1]; out[d + 2] = src[s]; out[d + 3] = src[s + 3];
      }
    }
    buf.unmap();
    buf.destroy();
    return { width: w, height: h, rgba: out };
  }

  // Scripted input for headless tests (same vocabulary as the native host).
  click(x, y) {
    this.dispatch(EV.POINTER, 1, 0, x, y, 0, 0);
    this.dispatch(EV.POINTER, 0, 0, x, y, 1, 0);
    this.dispatch(EV.POINTER, 2, 0, x, y, 0, 0);
  }
  text(s, kind = 0) { return this.withEvent(enc.encode(s), () => this.dispatch(EV.TEXT, kind, 0)); }
  key(code, mods = 0, phase = 0) { return this.dispatch(EV.KEY, phase, code, mods); }

  // ── DOM events ──

  attachEvents() {
    const c = this.canvas;
    c.style.touchAction = "none";
    const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const pid = (e) => (e.pointerType === "mouse" ? 0 : e.pointerId + 1);
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      if (this.dispatch(EV.POINTER, 0, pid(e), x, y, e.buttons, modsOf(e))) e.preventDefault();
      if (!this.imeActive) this.keySink().focus({ preventScroll: true });
      this.schedule();
    });
    c.addEventListener("pointermove", (e) => {
      const [x, y] = pos(e);
      this.dispatch(EV.POINTER, 1, pid(e), x, y, e.buttons, modsOf(e));
      this.schedule();
    });
    c.addEventListener("pointerup", (e) => {
      const [x, y] = pos(e);
      this.dispatch(EV.POINTER, 2, pid(e), x, y, e.buttons, modsOf(e));
      this.schedule();
    });
    c.addEventListener("pointercancel", (e) => { const [x, y] = pos(e); this.dispatch(EV.POINTER, 3, pid(e), x, y, 0, 0); this.schedule(); });
    c.addEventListener("pointerleave", (e) => { const [x, y] = pos(e); this.dispatch(EV.POINTER, 5, pid(e), x, y, 0, 0); this.schedule(); });
    c.addEventListener("wheel", (e) => {
      const [x, y] = pos(e);
      const unit = e.deltaMode === 0 ? 1 : 0;
      const k = e.deltaMode === 2 ? this.height : 1;
      if (this.dispatch(EV.WHEEL, modsOf(e), unit, x, y, e.deltaX * k, e.deltaY * k)) e.preventDefault();
      this.schedule();
    }, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    new ResizeObserver(() => {
      this.measure();
      this.dispatch(EV.RESIZE, 0, 0, this.width, this.height, this.scale);
      this.frameRequested = true;
      this.schedule();
    }).observe(c);
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener?.("change", () => {
      this.measure();
      this.dispatch(EV.RESIZE, 0, 0, this.width, this.height, this.scale);
      this.schedule();
    });
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const appearance = () => this.dispatch(EV.APPEARANCE, dark.matches ? 1 : 0);
    dark.addEventListener("change", () => { appearance(); this.schedule(); });
    appearance();
    document.addEventListener("visibilitychange", () => {
      this.dispatch(EV.LIFECYCLE, document.hidden ? 0 : 1);
      this.schedule();
    });
    window.addEventListener("focus", () => { this.dispatch(EV.FOCUS, 1); this.schedule(); });
    window.addEventListener("blur", () => { this.dispatch(EV.FOCUS, 0); this.schedule(); });
    this.keySink();
  }

  // The invisible textarea every keystroke and IME composition goes through.
  keySink() {
    if (this.sink) return this.sink;
    const t = document.createElement("textarea");
    t.setAttribute("autocapitalize", "off");
    t.setAttribute("autocomplete", "off");
    t.setAttribute("autocorrect", "off");
    t.setAttribute("spellcheck", "false");
    t.setAttribute("aria-hidden", "true");
    Object.assign(t.style, {
      position: "fixed", left: "0px", top: "0px", width: "1px", height: "1px", opacity: "0",
      padding: "0", border: "0", outline: "none", resize: "none", overflow: "hidden",
      fontSize: "16px", /* no zoom-on-focus on iOS */ caretColor: "transparent", whiteSpace: "pre",
    });
    document.body.appendChild(t);
    let composing = false;
    t.addEventListener("keydown", (e) => {
      if (composing || e.isComposing) return;
      const mods = modsOf(e);
      const shortcut = e.ctrlKey || e.metaKey;
      let code = KEYS[e.key];
      if (code == null && shortcut && e.key.length === 1) code = LETTER_KEYS[e.key.toLowerCase()];
      if (code == null && e.key === " " && shortcut) code = 60;
      if (code != null) {
        // Paste and copy go through the clipboard events below.
        if (shortcut && (code === 22 || code === 21 || code === 23)) {
          if (code === 23 || code === 21) this.dispatch(EV.KEY, e.repeat ? 2 : 0, code, mods);
          this.schedule();
          return;
        }
        if (this.dispatch(EV.KEY, e.repeat ? 2 : 0, code, mods)) e.preventDefault();
        else if (code === 2) e.preventDefault();
        this.schedule();
      }
    });
    t.addEventListener("keyup", (e) => {
      const code = KEYS[e.key];
      if (code != null) { this.dispatch(EV.KEY, 1, code, modsOf(e)); this.schedule(); }
    });
    t.addEventListener("compositionstart", () => { composing = true; });
    t.addEventListener("compositionupdate", (e) => {
      const s = e.data || "";
      this.withEvent(enc.encode(s), () => this.dispatch(EV.TEXT, 1, enc.encode(s).length));
      this.schedule();
    });
    t.addEventListener("compositionend", (e) => {
      composing = false;
      this.withEvent(new Uint8Array(0), () => this.dispatch(EV.TEXT, 2, 0));
      if (e.data) this.withEvent(enc.encode(e.data), () => this.dispatch(EV.TEXT, 0, 0));
      t.value = "";
      this.schedule();
    });
    t.addEventListener("input", (e) => {
      if (composing || e.isComposing) return;
      if (e.inputType === "insertText" || e.inputType === "insertReplacementText") {
        const s = e.data ?? t.value;
        if (s) this.withEvent(enc.encode(s), () => this.dispatch(EV.TEXT, 0, 0));
      } else if (e.inputType === "insertLineBreak") {
        this.dispatch(EV.KEY, 0, 1, 0);
      }
      t.value = "";
      this.schedule();
    });
    t.addEventListener("paste", (e) => {
      e.preventDefault();
      const s = e.clipboardData?.getData("text/plain") || "";
      this.withEvent(enc.encode(s), () => this.dispatch(EV.TEXT, 3, 0));
      this.schedule();
    });
    t.addEventListener("copy", (e) => e.preventDefault());
    t.addEventListener("cut", (e) => e.preventDefault());
    this.sink = t;
    return t;
  }

  imeBegin(x, y, w, h) {
    this.imeActive = true;
    this.imePlace(x, y, w, h);
    this.keySink().focus({ preventScroll: true });
  }
  imePlace(x, y, w, h) {
    const r = this.canvas.getBoundingClientRect();
    Object.assign(this.keySink().style, { left: `${r.left + x}px`, top: `${r.top + y}px`, height: `${Math.max(1, h)}px` });
  }
  imeEnd() { this.imeActive = false; }

  a11yCommit(focus) {
    if (this.headless) return;
    if (!this.a11yRoot) {
      const root = document.createElement("div");
      root.setAttribute("role", "application");
      Object.assign(root.style, { position: "fixed", inset: "0", pointerEvents: "none", overflow: "hidden" });
      Object.assign(root.dataset, { ceangalA11y: "" });
      document.body.appendChild(root);
      this.a11yRoot = root;
    }
    const r = this.canvas.getBoundingClientRect();
    const frag = document.createDocumentFragment();
    for (const n of this.a11yNodes || []) {
      const el = document.createElement(n.role === 3 ? "button" : "div");
      el.setAttribute("role", ROLES[n.role] || "group");
      if (n.label) el.setAttribute("aria-label", n.label);
      if (n.value != null) el.setAttribute("aria-valuetext", n.value);
      if (n.flags & 4) el.setAttribute("aria-selected", "true");
      if (n.flags & 8) el.setAttribute("aria-checked", "true");
      if (n.flags & 16) el.setAttribute("aria-disabled", "true");
      el.tabIndex = n.flags & 1 ? 0 : -1;
      Object.assign(el.style, { position: "absolute", left: `${r.left + n.x}px`, top: `${r.top + n.y}px`, width: `${n.w}px`, height: `${n.h}px`, opacity: "0", pointerEvents: "none" });
      el.addEventListener("click", () => { this.dispatch(EV.A11Y, n.id, 1); this.schedule(); });
      el.addEventListener("focus", () => { this.dispatch(EV.A11Y, n.id, 2); this.schedule(); });
      frag.appendChild(el);
    }
    this.a11yRoot.replaceChildren(frag);
  }

  deliver(id, status, body) {
    this.withEvent(body, () => this.dispatch(EV.RESULT, id, status));
    this.frameRequested = true;
    this.schedule();
  }

  async httpRun(id, r, body) {
    try {
      const res = await fetch(r.url, { method: r.method, headers: r.headers, body });
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          this.deliver(id, 1000 + res.status, value);
        }
        this.deliver(id, res.status, new Uint8Array(0));
      } else {
        this.deliver(id, res.status, new Uint8Array(await res.arrayBuffer()));
      }
    } catch (e) {
      this.deliver(id, 0, enc.encode(String(e)));
    }
  }

  fileOpen(id, kind) {
    const input = document.createElement("input");
    input.type = "file";
    if (kind === 0) input.accept = ".almd,.txt,.csv,.json,.md,text/*";
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      if (!f) return this.deliver(id, 0, new Uint8Array(0));
      const data = new Uint8Array(await f.arrayBuffer());
      const name = enc.encode(f.name);
      // body = u32 name length, name, contents
      const out = new Uint8Array(4 + name.length + data.length);
      new DataView(out.buffer).setUint32(0, name.length, true);
      out.set(name, 4);
      out.set(data, 4 + name.length);
      this.deliver(id, 200, out);
    });
    input.click();
  }
}

class GuestExit extends Error {
  constructor(code) { super(`exit ${code}`); this.code = code; }
}

function b64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
