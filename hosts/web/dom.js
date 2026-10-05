// The DOM side of the web host: input events, the invisible textarea for
// keys and IME, the ARIA overlay, cursor / title / clipboard / file pickers.
//
// A DomUi drives a *target* — anything with
//   dispatch(kind, a, b, x, y, z, w) -> number, withEvent(bytes, fn),
//   schedule(), deliver(id, status, bytes), resize(width, height, scale)
// which is the in-page Host, or (for user GUI programs) a proxy that forwards
// to a Host running in a Worker (gui.js).

export const EV = { INIT: 1, RESIZE: 2, FRAME: 3, POINTER: 4, WHEEL: 5, KEY: 6, TEXT: 7, FOCUS: 8, LIFECYCLE: 9, RESULT: 10, APPEARANCE: 11, A11Y: 12 };

export const KEYS = {
  Enter: 1, Tab: 2, Backspace: 3, Delete: 4, Escape: 5,
  ArrowLeft: 10, ArrowRight: 11, ArrowUp: 12, ArrowDown: 13, Home: 14, End: 15, PageUp: 16, PageDown: 17,
  F1: 40, F2: 41, F3: 42, F4: 43, F5: 44, F6: 45, F7: 46, F8: 47, F9: 48, F10: 49, F11: 50, F12: 51,
};
export const LETTER_KEYS = { a: 20, c: 21, v: 22, x: 23, z: 24, y: 25, s: 26, f: 27, o: 28, n: 29, w: 30 };
export const CURSORS = ["default", "text", "pointer", "grab", "ew-resize", "ns-resize"];
export const ROLES = { 1: "application", 2: "group", 3: "button", 4: "note", 5: "textbox", 6: "list", 7: "listitem", 8: "tab", 9: "tablist", 10: "heading", 11: "link", 12: "checkbox", 13: "img", 14: "textbox", 15: "switch", 16: "slider", 17: "dialog", 18: "radio", 19: "radiogroup", 20: "progressbar" };

const enc = new TextEncoder();

export function modsOf(e) {
  return (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
}

export const appleOS = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export class DomUi {
  constructor(canvas, target) {
    this.canvas = canvas;
    this.t = target;
    this.imeActive = false;
    this.sink = null;
    this.a11yRoot = null;
    this.cleanups = [];
  }

  measure() {
    const r = this.canvas.getBoundingClientRect();
    return { width: Math.max(1, r.width), height: Math.max(1, r.height), scale: window.devicePixelRatio || 1 };
  }

  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  attach() {
    const c = this.canvas, t = this.t;
    c.style.touchAction = "none";
    const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const pid = (e) => (e.pointerType === "mouse" ? 0 : e.pointerId + 1);
    this.on(c, "pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      if (t.dispatch(EV.POINTER, 0, pid(e), x, y, e.buttons, modsOf(e))) e.preventDefault();
      if (!this.imeActive) this.keySink().focus({ preventScroll: true });
      t.schedule();
    });
    this.on(c, "pointermove", (e) => { const [x, y] = pos(e); t.dispatch(EV.POINTER, 1, pid(e), x, y, e.buttons, modsOf(e)); t.schedule(); });
    this.on(c, "pointerup", (e) => { const [x, y] = pos(e); t.dispatch(EV.POINTER, 2, pid(e), x, y, e.buttons, modsOf(e)); t.schedule(); });
    this.on(c, "pointercancel", (e) => { const [x, y] = pos(e); t.dispatch(EV.POINTER, 3, pid(e), x, y, 0, 0); t.schedule(); });
    this.on(c, "pointerleave", (e) => { const [x, y] = pos(e); t.dispatch(EV.POINTER, 5, pid(e), x, y, 0, 0); t.schedule(); });
    this.on(c, "wheel", (e) => {
      const [x, y] = pos(e);
      const unit = e.deltaMode === 0 ? 1 : 0;
      const k = e.deltaMode === 2 ? this.measure().height : 1;
      if (t.dispatch(EV.WHEEL, modsOf(e), unit, x, y, e.deltaX * k, e.deltaY * k)) e.preventDefault();
      t.schedule();
    }, { passive: false });
    this.on(c, "contextmenu", (e) => e.preventDefault());
    const resized = () => { const m = this.measure(); t.resize(m.width, m.height, m.scale); };
    const ro = new ResizeObserver(resized);
    ro.observe(c);
    this.cleanups.push(() => ro.disconnect());
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.on(mq, "change", resized);
    const dark = matchMedia("(prefers-color-scheme: dark)");
    // Safe-area insets (notch, home indicator) come from CSS env(): a probe
    // element padded by them reports the current values.
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.appendChild(probe);
    this.cleanups.push(() => probe.remove());
    const appearance = () => {
      const cs = getComputedStyle(probe);
      const px = (v) => parseFloat(v) || 0;
      t.dispatch(EV.APPEARANCE, dark.matches ? 1 : 0, 0, px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft));
      t.schedule();
    };
    this.on(window, "resize", appearance);
    this.on(dark, "change", appearance);
    appearance();
    this.on(document, "visibilitychange", () => { t.dispatch(EV.LIFECYCLE, document.hidden ? 0 : 1); t.schedule(); });
    this.on(window, "focus", () => { t.dispatch(EV.FOCUS, 1); t.schedule(); });
    this.on(window, "blur", () => { t.dispatch(EV.FOCUS, 0); t.schedule(); });
    this.keySink();
  }

  destroy() {
    for (const f of this.cleanups.splice(0)) f();
    this.sink?.remove();
    this.a11yRoot?.remove();
    this.sink = this.a11yRoot = null;
  }

  // The invisible textarea every keystroke and IME composition goes through.
  keySink() {
    if (this.sink) return this.sink;
    const t = this.t;
    const s = document.createElement("textarea");
    s.setAttribute("autocapitalize", "off");
    s.setAttribute("autocomplete", "off");
    s.setAttribute("autocorrect", "off");
    s.setAttribute("spellcheck", "false");
    s.setAttribute("aria-hidden", "true");
    Object.assign(s.style, {
      position: "fixed", left: "0px", top: "0px", width: "1px", height: "1px", opacity: "0",
      padding: "0", border: "0", outline: "none", resize: "none", overflow: "hidden",
      fontSize: "16px", /* no zoom-on-focus on iOS */ caretColor: "transparent", whiteSpace: "pre",
    });
    document.body.appendChild(s);
    let composing = false;
    s.addEventListener("keydown", (e) => {
      if (composing || e.isComposing) return;
      const mods = modsOf(e);
      const shortcut = e.ctrlKey || e.metaKey;
      let code = KEYS[e.key];
      if (code == null && shortcut && e.key.length === 1) code = LETTER_KEYS[e.key.toLowerCase()];
      if (code == null && e.key === " " && shortcut) code = 60;
      if (code != null) {
        // Paste and copy go through the clipboard events below.
        if (shortcut && (code === 22 || code === 21 || code === 23)) {
          if (code === 23 || code === 21) t.dispatch(EV.KEY, e.repeat ? 2 : 0, code, mods);
          t.schedule();
          return;
        }
        if (t.dispatch(EV.KEY, e.repeat ? 2 : 0, code, mods)) e.preventDefault();
        else if (code === 2) e.preventDefault();
        t.schedule();
      }
    });
    s.addEventListener("keyup", (e) => {
      const code = KEYS[e.key];
      if (code != null) { t.dispatch(EV.KEY, 1, code, modsOf(e)); t.schedule(); }
    });
    s.addEventListener("compositionstart", () => { composing = true; });
    s.addEventListener("compositionupdate", (e) => {
      const d = enc.encode(e.data || "");
      t.withEvent(d, () => t.dispatch(EV.TEXT, 1, d.length));
      t.schedule();
    });
    s.addEventListener("compositionend", (e) => {
      composing = false;
      t.withEvent(new Uint8Array(0), () => t.dispatch(EV.TEXT, 2, 0));
      if (e.data) t.withEvent(enc.encode(e.data), () => t.dispatch(EV.TEXT, 0, 0));
      s.value = "";
      t.schedule();
    });
    s.addEventListener("input", (e) => {
      if (composing || e.isComposing) return;
      if (e.inputType === "insertText" || e.inputType === "insertReplacementText") {
        const v = e.data ?? s.value;
        if (v) t.withEvent(enc.encode(v), () => t.dispatch(EV.TEXT, 0, 0));
      } else if (e.inputType === "insertLineBreak") {
        t.dispatch(EV.KEY, 0, 1, 0);
      }
      s.value = "";
      t.schedule();
    });
    s.addEventListener("paste", (e) => {
      e.preventDefault();
      const v = e.clipboardData?.getData("text/plain") || "";
      t.withEvent(enc.encode(v), () => t.dispatch(EV.TEXT, 3, 0));
      t.schedule();
    });
    s.addEventListener("copy", (e) => e.preventDefault());
    s.addEventListener("cut", (e) => e.preventDefault());
    this.sink = s;
    return s;
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

  a11y(nodes, focus) {
    this.lastNodes = nodes;
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
    for (const n of nodes || []) {
      const el = document.createElement(n.role === 3 ? "button" : "div");
      if (n.role === 14) el.setAttribute("aria-multiline", "true");
      el.setAttribute("role", ROLES[n.role] || "group");
      if (n.label) el.setAttribute("aria-label", n.label);
      if (n.value != null) el.setAttribute("aria-valuetext", n.value);
      if (n.flags & 4) el.setAttribute("aria-selected", "true");
      if (n.flags & 8) el.setAttribute("aria-checked", "true");
      else if (n.role === 12 || n.role === 15 || n.role === 18) el.setAttribute("aria-checked", "false");
      if (n.flags & 16) el.setAttribute("aria-disabled", "true");
      el.tabIndex = n.flags & 1 ? 0 : -1;
      Object.assign(el.style, { position: "absolute", left: `${r.left + n.x}px`, top: `${r.top + n.y}px`, width: `${n.w}px`, height: `${n.h}px`, opacity: "0", pointerEvents: "none" });
      el.addEventListener("click", () => { this.t.dispatch(EV.A11Y, n.id, 1); this.t.schedule(); });
      el.addEventListener("focus", () => { this.t.dispatch(EV.A11Y, n.id, 2); this.t.schedule(); });
      frag.appendChild(el);
    }
    this.a11yRoot.replaceChildren(frag);
    void focus;
  }

  cursor(k) { this.canvas.style.cursor = CURSORS[k] || "default"; }
  title(s) { document.title = s; }
  openUrl(s) { window.open(s, "_blank", "noopener"); }
  location(loc) { try { history.replaceState(null, "", loc.startsWith("#") || loc.startsWith("?") ? loc : "#" + loc); } catch {} }
  clipboard(s) { navigator.clipboard?.writeText(s).catch(() => {}); }

  fileSave(id, name, bytes) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes]));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    queueMicrotask(() => this.t.deliver(id, 200, new Uint8Array(0)));
  }

  fileOpen(id, kind) {
    const input = document.createElement("input");
    input.type = "file";
    if (kind === 0) input.accept = ".almd,.txt,.csv,.json,.md,text/*";
    input.addEventListener("change", async () => {
      const f = input.files?.[0];
      if (!f) return this.t.deliver(id, 499, new Uint8Array(0));
      const data = new Uint8Array(await f.arrayBuffer());
      const name = enc.encode(f.name);
      // body = u32 name length, name, contents
      const out = new Uint8Array(4 + name.length + data.length);
      new DataView(out.buffer).setUint32(0, name.length, true);
      out.set(name, 4);
      out.set(data, 4 + name.length);
      this.t.deliver(id, 200, out);
    });
    input.click();
  }
}

// Headless runs: nothing to show, nothing to listen to.
export class NullUi {
  measure() { return null; }
  attach() {}
  destroy() {}
  imeBegin() {}
  imePlace() {}
  imeEnd() {}
  a11y() {}
  cursor() {}
  title() {}
  openUrl() {}
  location() {}
  clipboard() {}
  // Headless pages still download (tests capture it); workers cannot.
  fileSave(id, name, bytes) {
    if (typeof document !== "undefined") return DomUi.prototype.fileSave.call(this, id, name, bytes);
    this.t?.deliver(id, 200, new Uint8Array(0));
  }
  fileOpen(id) { this.t?.deliver(id, 499, new Uint8Array(0)); }
}
