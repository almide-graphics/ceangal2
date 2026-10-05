// ceangal2 web host — implements docs/abi.md for a wasm guest in a browser.
//
//   import { start } from "./host.js";
//   const app = await start({ canvas, wasm: "app.wasm", assets: { "fonts/ui.ttf": url } });
//
// Rendering is WebGPU only. Text input, IME and screen readers go through an
// invisible textarea and an ARIA overlay; every visible pixel comes from the
// guest via snaidhm.

import { EV, DomUi, NullUi, appleOS } from "./dom.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

export class UnsupportedError extends Error {}

export async function gpuDevice() {
  if (!navigator.gpu) throw new UnsupportedError("WebGPU is not available in this browser");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
  if (!adapter) throw new UnsupportedError("No WebGPU adapter");
  return adapter.requestDevice();
}

export async function start(opts) {
  const { canvas, wasm, assets = {}, headless = null, appId = "ceangal" } = opts;
  const device = await gpuDevice();
  const host = new Host({ device, canvas, headless, appId, onError: opts.onError });
  host.extensions = opts.extensions || [];
  host.launch = opts.launch ?? null;
  await host.loadAssets(assets, opts.lazy);
  await host.instantiate(wasm);
  host.boot();
  return host;
}

// `ui` is where DOM-side requests go: a DomUi in a page, a NullUi headless,
// or (in a Worker running a user GUI program) a RemoteUi from gui-worker.js.
export class Host {
  constructor({ device, canvas, headless, appId, onError, ui, stdout }) {
    this.device = device;
    this.canvas = canvas;
    this.ui = ui || (headless || !canvas ? new NullUi() : new DomUi(canvas, this));
    this.ui.t ??= this;
    this.stdout = stdout || ((fd, text) => (fd === 2 ? console.error : console.log)(text));
    this.headless = headless;
    this.appId = appId;
    this.onError = onError || ((e) => console.error(e));
    this.extensions = [];
    this.launch = null;
    this.handles = [null];
    this.free = [];
    this.bindings = [];
    this.encoder = null;
    this.frameTex = null;
    this.eventData = new Uint8Array(0);
    this.assets = new Map();
    this.frameRequested = true;
    this.clock = 0;
    this.timers = [];
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
      this.width = canvas.width || 1;
      this.height = canvas.height || 1;
      this.scale = 1;
      this.context.configure({ device, format: this.format, alphaMode: "opaque" });
    }
  }

  // Fallback fonts (CJK, Arabic, Hebrew, Thai, emoji: megabytes between
  // them) are fetched the first time the app asks for them, not before it
  // starts; until then asset_len says -1 and the app draws again once they
  // arrive. `lazy: (name) => bool` in the start options overrides the rule.
  async loadAssets(assets, lazy = (name) => /^fonts\/(cjk|arabic|hebrew|thai|emoji|emoji-color|devanagari|bengali|tamil)\.ttf$/.test(name)) {
    this.lazyAssets = new Map();
    await Promise.all(Object.entries(assets).map(async ([name, src]) => {
      if (!(src instanceof Uint8Array) && lazy(name)) { this.lazyAssets.set(name, src); return; }
      const data = src instanceof Uint8Array ? src : new Uint8Array(await (await fetch(src)).arrayBuffer());
      this.assets.set(name, data);
    }));
  }

  fetchLazy(name) {
    const src = this.lazyAssets?.get(name);
    if (!src) return;
    this.lazyAssets.delete(name);
    fetch(src).then((r) => r.arrayBuffer()).then((b) => {
      this.assets.set(name, new Uint8Array(b));
      this.frameRequested = true;
      this.schedule();
    }).catch(() => {});
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
      request_frame_after: (ms) => {
        // Headless: a virtual timer that settle() fast-forwards to.
        if (self.headless) { self.timers.push(self.clock + Math.max(0, ms)); return; }
        setTimeout(() => { self.frameRequested = true; self.schedule(); }, Math.max(0, ms));
      },
      now_ms: () => performance.now(),
      log: (p, n) => console.log(self.str(p, n)),
      event_len: () => BigInt(self.eventData.length),
      event_read: (p, n) => self.fill(self.eventData, p, n),
      platform: () => (!self.headless && (self.ui.apple ?? appleOS()) ? 17n : 1n),
      set_cursor: (k) => self.ui.cursor(Number(k)),
      set_title: (p, n) => self.ui.title(self.str(p, n)),
      open_url: (p, n) => self.ui.openUrl(self.str(p, n)),
      asset_len: (p, n) => { const name = self.str(p, n); const a = self.assets.get(name); if (!a) self.fetchLazy(name); return BigInt(a ? a.length : -1); },
      asset_read: (p, n, dp, dn) => { const a = self.assets.get(self.str(p, n)); return a ? self.fill(a, dp, dn) : 0n; },
      exit: () => { self.dead = true; },
      launch_len: () => BigInt(enc.encode(self.launchString()).length),
      launch_read: (p, n) => self.fill(enc.encode(self.launchString()), p, n),
      set_location: (p, n) => { if (!self.headless) self.ui.location(self.str(p, n)); },
    };

    const text_input = {
      ime_begin: (x, y, w, h) => self.ui.imeBegin(x, y, w, h),
      ime_update: (x, y, w, h) => self.ui.imePlace(x, y, w, h),
      ime_end: () => self.ui.imeEnd(),
    };

    const a11y = {
      // The ARIA overlay (and headless tests) always consume the tree.
      a11y_active: () => 1n,
      a11y_begin: () => { self.a11yNodes = []; },
      a11y_node: (id, parent, role, x, y, w, h, flags, lp, ln) => {
        (self.a11yNodes ||= []).push({ id: Number(id), parent: Number(parent), role: Number(role), x, y, w, h, flags: Number(flags), label: self.str(lp, ln) });
      },
      a11y_value: (id, p, n) => {
        const node = (self.a11yNodes || []).findLast((m) => m.id === Number(id));
        if (node) node.value = self.str(p, n);
      },
      a11y_commit: (focus) => self.ui.a11y(self.a11yNodes || [], Number(focus)),
    };

    const clipboard = {
      clipboard_write: (p, n) => self.ui.clipboard(self.str(p, n)),
    };

    // localStorage in a page; an in-memory sandbox in a Worker (user GUI
    // programs never see the playground's storage or secrets).
    const store = typeof localStorage !== "undefined" ? localStorage : memoryStorage();
    const kv = (prefix) => ({
      len: (kp, kn) => { const v = store.getItem(prefix + self.str(kp, kn)); return BigInt(v == null ? -1 : unb64(v).length); },
      read: (kp, kn, dp, dn) => { const v = store.getItem(prefix + self.str(kp, kn)); return v == null ? 0n : self.fill(unb64(v), dp, dn); },
      write: (kp, kn, p, n) => { try { store.setItem(prefix + self.str(kp, kn), b64(self.bytes(p, n))); } catch {} },
      remove: (kp, kn) => store.removeItem(prefix + self.str(kp, kn)),
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
      http_cancel: (id) => { self.httpAborts.get(Number(id))?.abort(); },
    };

    const file = {
      file_open: (kind) => { const id = self.nextRequest++; self.ui.fileOpen(id, Number(kind)); return BigInt(id); },
      file_save: (np, nn, p, n) => { const id = self.nextRequest++; self.ui.fileSave(id, self.str(np, nn), self.bytes(p, n)); return BigInt(id); },
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
        self.stdout(fd, text.replace(/\n$/, ""));
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
    const base = { gpu, sys, text_input, a11y, clipboard, storage, net, file, wasi_snapshot_preview1: wasiProxy };
    // App-specific namespaces (e.g. the playground's `runner`).
    for (const ext of this.extensions) Object.assign(base, ext(this));
    return base;
  }

  launchString() {
    if (this.launch != null) return this.launch;
    if (this.headless || typeof location === "undefined") return "";
    return location.href;
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
      this.dead = true;
      if (e instanceof GuestExit) {
        if (e.code !== 0) this.onError(new Error(`guest exited with status ${e.code} during event ${kind}`));
        return 0;
      }
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
      this.ui.attach();
    }
    this.dispatch(EV.INIT, 0, 0, this.width, this.height, this.scale);
    this.schedule();
  }

  measure() {
    const m = this.ui.measure();
    if (m) { this.width = m.width; this.height = m.height; this.scale = m.scale; }
  }

  // The UI side saw a new size (ResizeObserver, DPR change, or the page
  // hosting a worker's canvas).
  resize(width, height, scale) {
    this.width = width;
    this.height = height;
    this.scale = scale;
    this.dispatch(EV.RESIZE, 0, 0, width, height, scale);
    this.frameRequested = true;
    this.schedule();
  }

  schedule() {
    if (this.headless || this.rafPending || this.dead) return;
    if (!this.frameRequested && !this.animating) return;
    this.rafPending = true;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f) => setTimeout(() => f(performance.now()), 16);
    raf((t) => {
      this.rafPending = false;
      this.frameRequested = false;
      this.animating = this.dispatch(EV.FRAME, 0, 0, t) === 1;
      this.schedule();
    });
  }

  // Headless: render frames until settled, then read the target back as RGBA.
  // Headless: run frames until the guest is idle. Time is virtual — each
  // frame advances it 16 ms, and when only timers remain it jumps to the
  // earliest one, so debounces and timeouts resolve without waiting.
  async settle(maxFrames = 8) {
    for (let i = 0; i < maxFrames; i++) {
      let wanted = this.frameRequested;
      if (!wanted && this.timers.length) {
        const due = Math.min(...this.timers);
        this.timers = this.timers.filter((t) => t !== due);
        this.clock = Math.max(this.clock, due);
        wanted = true;
      }
      this.frameRequested = false;
      const again = this.dispatch(EV.FRAME, 0, 0, this.clock) === 1;
      this.clock += 16;
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
  wheel(x, y, dy, dx = 0) { return this.dispatch(EV.WHEEL, 0, 1, x, y, dx, dy); }

  deliver(id, status, body) {
    this.withEvent(body, () => this.dispatch(EV.RESULT, id, status));
    this.frameRequested = true;
    this.schedule();
  }

  async httpRun(id, r, body) {
    const abort = new AbortController();
    (this.httpAborts ||= new Map()).set(id, abort);
    try {
      const res = await fetch(r.url, { method: r.method, headers: r.headers, body, signal: abort.signal });
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
      // A cancelled request delivers nothing more (docs/abi.md §4.7).
      if (!abort.signal.aborted) this.deliver(id, 0, enc.encode(String(e)));
    } finally {
      this.httpAborts.delete(id);
    }
  }
}

export class GuestExit extends Error {
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

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}
