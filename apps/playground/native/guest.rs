//! User GUI programs in the native playground (docs/abi.md §5): a wasmi
//! instance driving its own GpuContext — an offscreen texture on the
//! playground's device, which the playground draws with
//! `gpu.external_texture`. The program's imports come from guest_abi.rs
//! (generated): gpu / clipboard forward to the host, everything else lands in
//! the sandbox below (own event buffer, frame requests, in-memory storage, no
//! network or files). Every event runs with a fuel budget; Stop or an exit
//! drops the store and the context, and with them every GPU resource.

#![allow(dead_code)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Mutex;

use wasmi::{Caller, Config, Engine, Linker, Module, Store, TypedFunc};

use crate::gpu::{self, GpuContext};
use crate::pg_wasi::{WasiCtx, WasiHost};

/// Instructions one event may run before the program is stopped.
const FUEL_PER_EVENT: u64 = 2_000_000_000;
const MAX_TEXTURE: i64 = 8192;

#[derive(Clone, Debug)]
pub struct A11yNode { pub id: i64, pub role: i64, pub rect: (f64, f64, f64, f64), pub flags: i64, pub label: String, pub value: Option<String> }

pub struct Guest {
    pub wasi: WasiCtx,
    pub event_data: Vec<u8>,
    pub frame_requested: bool,
    pub deadline: Option<f64>,
    pub cursor: i64,
    pub exit: Option<i64>,
    pub storage: HashMap<String, Vec<u8>>,
    pub secrets: HashMap<String, Vec<u8>>,
    pub a11y_building: Vec<A11yNode>,
    pub a11y: Vec<A11yNode>,
    pub ime: Option<(f64, f64, f64, f64)>,
}

impl WasiHost for Guest {
    fn wasi(&mut self) -> &mut WasiCtx { &mut self.wasi }
}

fn memory(c: &Caller<'_, Guest>) -> Option<wasmi::Memory> {
    c.get_export("memory").and_then(|e| e.into_memory())
}

/// A copy of the guest's byte range (empty when out of bounds).
pub fn guest_bytes(c: &Caller<'_, Guest>, ptr: i64, len: i64) -> Vec<u8> {
    let Some(m) = memory(c) else { return Vec::new() };
    let d = m.data(c);
    let (p, n) = (ptr.max(0) as usize, len.max(0) as usize);
    if p.checked_add(n).is_some_and(|e| e <= d.len()) { d[p..p + n].to_vec() } else { Vec::new() }
}

fn guest_string(c: &Caller<'_, Guest>, ptr: i64, len: i64) -> String {
    String::from_utf8_lossy(&guest_bytes(c, ptr, len)).into_owned()
}

/// Copy `src` into the guest buffer; returns the bytes written.
fn guest_fill(c: &mut Caller<'_, Guest>, ptr: i64, len: i64, src: &[u8]) -> i64 {
    let Some(m) = memory(c) else { return 0 };
    let d = m.data_mut(c);
    let n = src.len().min(len.max(0) as usize);
    let p = ptr.max(0) as usize;
    if p + n > d.len() { return 0 }
    d[p..p + n].copy_from_slice(&src[..n]);
    n as i64
}


// ── sys ──
pub fn sys_abi_version(_c: &mut Caller<'_, Guest>) -> i64 { 1 }
pub fn sys_run(_c: &mut Caller<'_, Guest>) {}
pub fn sys_request_frame(c: &mut Caller<'_, Guest>) { c.data_mut().frame_requested = true; }
pub fn sys_request_frame_after(c: &mut Caller<'_, Guest>, ms: f64) {
    let at = crate::sys::now_ms() + ms.max(0.0);
    let d = &mut c.data_mut().deadline;
    *d = Some(d.map_or(at, |x| x.min(at)));
}
pub fn sys_now_ms(_c: &mut Caller<'_, Guest>) -> f64 { crate::sys::now_ms() }
pub fn sys_log(c: &mut Caller<'_, Guest>, ptr: i64, len: i64) {
    let s = guest_bytes(c, ptr, len);
    (c.data_mut().wasi.sink)(2, &[s, b"\n".to_vec()].concat());
}
pub fn sys_event_len(c: &mut Caller<'_, Guest>) -> i64 { c.data().event_data.len() as i64 }
pub fn sys_event_read(c: &mut Caller<'_, Guest>, ptr: i64, len: i64) -> i64 {
    let d = c.data().event_data.clone();
    guest_fill(c, ptr, len, &d)
}
pub fn sys_platform(_c: &mut Caller<'_, Guest>) -> i64 { crate::sys::platform() }
pub fn sys_set_cursor(c: &mut Caller<'_, Guest>, kind: i64) { c.data_mut().cursor = kind; }
pub fn sys_set_title(_c: &mut Caller<'_, Guest>, _p: i64, _l: i64) {}
pub fn sys_open_url(_c: &mut Caller<'_, Guest>, _p: i64, _l: i64) {}
/// Programs may read the bundled fonts, nothing else.
fn font_asset(name: &str) -> Option<Vec<u8>> {
    if !name.starts_with("fonts/") { return None }
    crate::sys::with_asset(name, |d| d.map(|d| d.to_vec()))
}
pub fn sys_asset_len(c: &mut Caller<'_, Guest>, np: i64, nl: i64) -> i64 {
    font_asset(&guest_string(c, np, nl)).map_or(-1, |d| d.len() as i64)
}
pub fn sys_asset_read(c: &mut Caller<'_, Guest>, np: i64, nl: i64, dp: i64, dl: i64) -> i64 {
    match font_asset(&guest_string(c, np, nl)) { Some(d) => guest_fill(c, dp, dl, &d), None => 0 }
}
pub fn sys_exit(c: &mut Caller<'_, Guest>, code: i64) { c.data_mut().exit = Some(code); }
pub fn sys_launch_len(_c: &mut Caller<'_, Guest>) -> i64 { 0 }
pub fn sys_launch_read(_c: &mut Caller<'_, Guest>, _p: i64, _l: i64) -> i64 { 0 }
pub fn sys_set_location(_c: &mut Caller<'_, Guest>, _p: i64, _l: i64) {}

// ── text_input: the caret rect, which the playground hands to the IME ──
pub fn text_input_ime_begin(c: &mut Caller<'_, Guest>, x: f64, y: f64, w: f64, h: f64) { c.data_mut().ime = Some((x, y, w, h)); }
pub fn text_input_ime_update(c: &mut Caller<'_, Guest>, x: f64, y: f64, w: f64, h: f64) { c.data_mut().ime = Some((x, y, w, h)); }
pub fn text_input_ime_end(c: &mut Caller<'_, Guest>) { c.data_mut().ime = None; }

// ── a11y: kept for the playground (and tests) ──
pub fn a11y_a11y_active(_c: &mut Caller<'_, Guest>) -> i64 { 1 }
pub fn a11y_a11y_begin(c: &mut Caller<'_, Guest>) { c.data_mut().a11y_building.clear(); }
pub fn a11y_a11y_node(c: &mut Caller<'_, Guest>, id: i64, _parent: i64, role: i64, x: f64, y: f64, w: f64, h: f64, flags: i64, lp: i64, ll: i64) {
    let label = guest_string(c, lp, ll);
    c.data_mut().a11y_building.push(A11yNode { id, role, rect: (x, y, w, h), flags, label, value: None });
}
pub fn a11y_a11y_value(c: &mut Caller<'_, Guest>, id: i64, p: i64, l: i64) {
    let v = guest_string(c, p, l);
    if let Some(n) = c.data_mut().a11y_building.iter_mut().rev().find(|n| n.id == id) { n.value = Some(v); }
}
pub fn a11y_a11y_commit(c: &mut Caller<'_, Guest>, _focus: i64) {
    let g = c.data_mut();
    g.a11y = std::mem::take(&mut g.a11y_building);
}

// ── storage: an in-memory sandbox per run ──
fn kv<'a>(c: &'a mut Caller<'_, Guest>, secret: bool) -> &'a mut HashMap<String, Vec<u8>> {
    let g = c.data_mut();
    if secret { &mut g.secrets } else { &mut g.storage }
}
fn kv_len(c: &mut Caller<'_, Guest>, s: bool, kp: i64, kl: i64) -> i64 { let k = guest_string(c, kp, kl); kv(c, s).get(&k).map_or(-1, |v| v.len() as i64) }
fn kv_read(c: &mut Caller<'_, Guest>, s: bool, kp: i64, kl: i64, dp: i64, dl: i64) -> i64 {
    let k = guest_string(c, kp, kl);
    match kv(c, s).get(&k).cloned() { Some(v) => guest_fill(c, dp, dl, &v), None => 0 }
}
fn kv_write(c: &mut Caller<'_, Guest>, s: bool, kp: i64, kl: i64, p: i64, l: i64) { let k = guest_string(c, kp, kl); let v = guest_bytes(c, p, l); kv(c, s).insert(k, v); }
fn kv_remove(c: &mut Caller<'_, Guest>, s: bool, kp: i64, kl: i64) { let k = guest_string(c, kp, kl); kv(c, s).remove(&k); }
pub fn storage_storage_len(c: &mut Caller<'_, Guest>, kp: i64, kl: i64) -> i64 { kv_len(c, false, kp, kl) }
pub fn storage_storage_read(c: &mut Caller<'_, Guest>, kp: i64, kl: i64, dp: i64, dl: i64) -> i64 { kv_read(c, false, kp, kl, dp, dl) }
pub fn storage_storage_write(c: &mut Caller<'_, Guest>, kp: i64, kl: i64, p: i64, l: i64) { kv_write(c, false, kp, kl, p, l) }
pub fn storage_storage_remove(c: &mut Caller<'_, Guest>, kp: i64, kl: i64) { kv_remove(c, false, kp, kl) }
pub fn storage_secret_len(c: &mut Caller<'_, Guest>, kp: i64, kl: i64) -> i64 { kv_len(c, true, kp, kl) }
pub fn storage_secret_read(c: &mut Caller<'_, Guest>, kp: i64, kl: i64, dp: i64, dl: i64) -> i64 { kv_read(c, true, kp, kl, dp, dl) }
pub fn storage_secret_write(c: &mut Caller<'_, Guest>, kp: i64, kl: i64, p: i64, l: i64) { kv_write(c, true, kp, kl, p, l) }
pub fn storage_secret_remove(c: &mut Caller<'_, Guest>, kp: i64, kl: i64) { kv_remove(c, true, kp, kl) }

// ── net / file: not available to programs in the playground ──
pub fn net_http_begin(_c: &mut Caller<'_, Guest>, _a: i64, _b: i64, _d: i64, _e: i64) -> i64 { 0 }
pub fn net_http_header(_c: &mut Caller<'_, Guest>, _id: i64, _a: i64, _b: i64, _d: i64, _e: i64) {}
pub fn net_http_send(_c: &mut Caller<'_, Guest>, _id: i64, _a: i64, _b: i64) {}
pub fn net_http_cancel(_c: &mut Caller<'_, Guest>, _id: i64) {}
pub fn file_file_open(_c: &mut Caller<'_, Guest>, _k: i64) -> i64 { 0 }
pub fn file_file_save(_c: &mut Caller<'_, Guest>, _a: i64, _b: i64, _d: i64, _e: i64) -> i64 { 0 }

// ── The session ──

type EventFn = TypedFunc<(i64, i64, i64, f64, f64, f64, f64), i64>;

pub struct Session {
    pub run_id: i64,
    store: Store<Guest>,
    event: EventFn,
    ctx: Rc<RefCell<GpuContext>>,
    size: (f64, f64, f64),
    animating: bool,
    /// The playground-side handle of our offscreen texture, and its size.
    tex: i64,
    tex_px: (u32, u32),
    pub started_at: f64,
}

pub enum End { Exit(i64), Error(String) }

thread_local! {
    pub static SESSION: RefCell<Option<Session>> = const { RefCell::new(None) };
}

/// A compiled GUI program waiting for the UI thread (set by the run thread).
pub static PENDING: Mutex<Option<(i64, Vec<u8>, HashMap<String, Vec<u8>>, Vec<u8>)>> = Mutex::new(None);

impl Session {
    pub fn new(run_id: i64, wasm: &[u8], files: HashMap<String, Vec<u8>>, stdin: Vec<u8>) -> Result<Session, String> {
        let mut cfg = Config::default();
        cfg.consume_fuel(true);
        let engine = Engine::new(&cfg);
        let module = Module::new(&engine, wasm).map_err(|e| e.to_string())?;
        let sink = Box::new(move |fd: i32, bytes: &[u8]| crate::runner::stream_out(run_id, fd, bytes));
        let guest = Guest {
            wasi: WasiCtx::new(files, stdin, sink),
            event_data: Vec::new(), frame_requested: true, deadline: None, cursor: 0, exit: None,
            storage: HashMap::new(), secrets: HashMap::new(), a11y_building: Vec::new(), a11y: Vec::new(), ime: None,
        };
        let mut store = Store::new(&engine, guest);
        let mut linker = Linker::<Guest>::new(&engine);
        crate::guest_abi::link(&mut linker).map_err(|e| e.to_string())?;
        crate::pg_wasi::link(&mut linker, &module).map_err(|e| e.to_string())?;
        let instance = linker.instantiate_and_start(&mut store, &module).map_err(|e| e.to_string())?;
        let event = instance.get_typed_func::<(i64, i64, i64, f64, f64, f64, f64), i64>(&store, "ceangal_event").map_err(|e| e.to_string())?;
        let ctx = Rc::new(RefCell::new(GpuContext::new()));
        let mut s = Session { run_id, store, event, ctx, size: (0.0, 0.0, 1.0), animating: false, tex: 0, tex_px: (0, 0), started_at: crate::sys::now_ms() };
        // main(): sets up the ceangal app (and returns; the host drives it).
        if let Ok(start) = instance.get_typed_func::<(), ()>(&s.store, "_start") {
            s.store.set_fuel(FUEL_PER_EVENT).ok();
            let ctx = s.ctx.clone();
            let r = gpu::enter(&ctx, || start.call(&mut s.store, ()));
            if let Err(e) = r {
                if e.i32_exit_status() != Some(0) { return Err(e.to_string()) }
            }
        }
        Ok(s)
    }

    /// One event into the program. `Err` ends the session.
    pub fn dispatch(&mut self, kind: i64, a: i64, b: i64, x: f64, y: f64, z: f64, w: f64) -> Result<i64, End> {
        self.store.set_fuel(FUEL_PER_EVENT).ok();
        let ctx = self.ctx.clone();
        let event = self.event;
        let r = gpu::enter(&ctx, || event.call(&mut self.store, (kind, a, b, x, y, z, w)));
        if let Some(code) = self.store.data().exit { return Err(End::Exit(code)) }
        match r {
            Ok(v) => Ok(v),
            Err(e) => match e.i32_exit_status() {
                Some(code) => Err(End::Exit(code as i64)),
                None if matches!(e.as_trap_code(), Some(wasmi::TrapCode::OutOfFuel)) =>
                    Err(End::Error("the program ran too long handling one event (an endless loop?) and was stopped".into())),
                None => Err(End::Error(e.to_string())),
            },
        }
    }

    pub fn with_data(&mut self, data: &[u8], f: impl FnOnce(&mut Session) -> Result<i64, End>) -> Result<i64, End> {
        self.store.data_mut().event_data = data.to_vec();
        let r = f(self);
        self.store.data_mut().event_data.clear();
        r
    }

    /// Size the window, run a frame if one is due, and return the texture
    /// handle (in the CALLING context) to draw. Called while the playground
    /// paints.
    pub fn place(&mut self, w: f64, h: f64, scale: f64) -> Result<i64, End> {
        let px = (((w * scale).ceil() as i64).clamp(1, MAX_TEXTURE) as u32, ((h * scale).ceil() as i64).clamp(1, MAX_TEXTURE) as u32);
        let first = self.size.0 == 0.0;
        if (w, h, scale) != self.size {
            self.size = (w, h, scale);
            self.ctx.borrow_mut().set_offscreen(px.0, px.1);
            self.dispatch(if first { 1 } else { 2 }, 0, 0, w, h, scale, 0.0)?;
            self.store.data_mut().frame_requested = true;
        }
        let now = crate::sys::now_ms();
        let due = self.store.data().deadline.is_some_and(|d| d <= now);
        if due { self.store.data_mut().deadline = None; }
        if self.store.data().frame_requested || self.animating || due {
            self.store.data_mut().frame_requested = false;
            self.animating = self.dispatch(3, 0, 0, now, 0.0, 0.0, 0.0)? == 1;
        }
        if px != self.tex_px || self.tex == 0 {
            if self.tex != 0 { gpu::release(self.tex); }
            self.tex = gpu::external_texture(self.ctx.borrow().id as i64);
            self.tex_px = px;
        }
        Ok(self.tex)
    }

    /// Whether the program wants another frame soon (the playground keeps
    /// requesting frames while this holds).
    pub fn wants_frame(&self) -> bool {
        let g = self.store.data();
        self.animating || g.frame_requested
    }
    pub fn deadline(&self) -> Option<f64> { self.store.data().deadline }
    pub fn cursor(&self) -> i64 { self.store.data().cursor }
    pub fn ime(&self) -> Option<(f64, f64, f64, f64)> { self.store.data().ime }
    pub fn a11y(&self) -> &[A11yNode] { &self.store.data().a11y }

    /// Release the playground-side texture handle (the context itself goes
    /// with the session).
    pub fn release(&mut self) {
        if self.tex != 0 { gpu::release(self.tex); self.tex = 0; }
    }
}
