//! `runner` namespace for natively built playgrounds (docs/abi.md §4.8, §5):
//! the Almide compiler linked in (`almide-compiler-service`), programs run on
//! wasmi (docs/adr/0003-wasm-runtime.md).
//!
//! check / rust / ast / run compile on worker threads and answer through
//! `sys::post_result`. A console program runs on its thread in fuel slices
//! (Stop flips a flag that the next slice sees). A GUI program — one that
//! exports `ceangal_event` — is handed to the UI thread, where guest.rs runs
//! it as a window inside the Visual pane.

#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use almide_compiler_service as cs;
use wasmi::{Config, Engine, Linker, Module, Store, TypedResumableCall};

use crate::guest::{End, Session, PENDING, SESSION};
use crate::pg_wasi::{WasiCtx, WasiHost};
use crate::sys::{begin_async, finish_async, next_request_id, post_result};

const FUEL_SLICE: u64 = 50_000_000;
const STDIN_TAB: &str = "stdin.txt";

static STOPS: Mutex<Option<HashMap<i64, Arc<AtomicBool>>>> = Mutex::new(None);
static LINES: Mutex<Option<HashMap<(i64, i32), Vec<u8>>>> = Mutex::new(None);

fn json_str(s: &str) -> String {
    let mut o = String::from("\"");
    for ch in s.chars() {
        match ch {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn error_body(phase: &str, error: &str) -> Vec<u8> {
    format!("{{\"phase\":{},\"error\":{}}}", json_str(phase), json_str(error)).into_bytes()
}

/// stdout / stderr bytes of run `id`, posted line by line (100 / 101).
/// Tests: `CEANGAL_RUN_LOG=<file>` also appends every run's raw stdout.
pub fn stream_out(id: i64, fd: i32, bytes: &[u8]) {
    if fd == 1 {
        if let Ok(path) = std::env::var("CEANGAL_RUN_LOG") {
            use std::io::Write;
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) { let _ = f.write_all(bytes); }
        }
    }
    let mut lines = LINES.lock().unwrap();
    let buf = lines.get_or_insert_with(HashMap::new).entry((id, fd)).or_default();
    buf.extend_from_slice(bytes);
    while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
        let line: Vec<u8> = buf.drain(..=nl).take(nl).collect();
        post_result(id, if fd == 2 { 101 } else { 100 }, line);
    }
}

fn flush_out(id: i64) {
    let mut lines = LINES.lock().unwrap();
    for fd in [1, 2] {
        if let Some(rest) = lines.get_or_insert_with(HashMap::new).remove(&(id, fd)) {
            if !rest.is_empty() { post_result(id, if fd == 2 { 101 } else { 100 }, rest); }
        }
    }
}

/// The tab set the playground sends: { "name": "content", … }.
fn parse_files(json: &str) -> HashMap<String, String> {
    serde_json::from_str::<HashMap<String, String>>(json).unwrap_or_default()
}

fn data_files(files: &HashMap<String, String>) -> (HashMap<String, Vec<u8>>, Vec<u8>) {
    let data = files.iter().filter(|(n, _)| !n.ends_with(".almd") && n.as_str() != STDIN_TAB).map(|(n, c)| (n.clone(), c.clone().into_bytes())).collect();
    (data, files.get(STDIN_TAB).cloned().unwrap_or_default().into_bytes())
}

/// Run `f` on a worker thread; its result is the request's final event.
fn spawn(f: impl FnOnce(i64) -> (i64, Vec<u8>) + Send + 'static) -> i64 {
    let id = next_request_id();
    begin_async();
    std::thread::Builder::new().stack_size(64 << 20).spawn(move || {
        let (status, body) = f(id);
        finish_async(id, status, Some(body));
    }).expect("spawn runner thread");
    id
}

// ── version / check / rust / ast ──

fn version() -> String { format!("{} · native", cs::get_version_info()) }
pub fn runner_version_len() -> i64 { version().len() as i64 }
pub fn runner_version_read(ptr: i64, len: i64) -> i64 { crate::sys::fill(version().as_bytes(), ptr, len) }

pub fn runner_check(fp: i64, fl: i64, ep: i64, el: i64) -> i64 {
    let (files, entry) = (crate::sys::string(fp, fl), crate::sys::string(ep, el));
    spawn(move |_| (200, cs::check_project(&files, &entry).into_bytes()))
}

pub fn runner_rust(fp: i64, fl: i64, ep: i64, el: i64) -> i64 {
    let (files, entry) = (crate::sys::string(fp, fl), crate::sys::string(ep, el));
    spawn(move |_| match cs::compile_project_to_rust(&files, &entry) {
        Ok(code) => (200, code.into_bytes()),
        Err(e) => (500, error_body("compile", &e)),
    })
}

pub fn runner_ast(sp: i64, sl: i64) -> i64 {
    let src = crate::sys::string(sp, sl);
    spawn(move |_| match cs::parse_to_ast(&src) {
        Ok(ast) => (200, ast.into_bytes()),
        Err(e) => (500, error_body("parse", &e)),
    })
}

// ── run ──

struct ConsoleData { wasi: WasiCtx }
impl WasiHost for ConsoleData { fn wasi(&mut self) -> &mut WasiCtx { &mut self.wasi } }

fn is_gui(wasm: &[u8]) -> bool {
    let engine = Engine::default();
    Module::new(&engine, wasm).map(|m| m.exports().any(|e| e.name() == "ceangal_event")).unwrap_or(false)
}

fn run_console(id: i64, wasm: &[u8], files: &HashMap<String, String>, stop: &AtomicBool, compile_ms: f64) -> (i64, Vec<u8>) {
    let t0 = crate::sys::now_ms();
    let mut cfg = Config::default();
    cfg.consume_fuel(true);
    let engine = Engine::new(&cfg);
    let module = match Module::new(&engine, wasm) { Ok(m) => m, Err(e) => return (500, error_body("runtime", &e.to_string())) };
    let (data, stdin) = data_files(files);
    let sink = Box::new(move |fd: i32, bytes: &[u8]| stream_out(id, fd, bytes));
    let mut store = Store::new(&engine, ConsoleData { wasi: WasiCtx::new(data, stdin, sink) });
    let mut linker = Linker::<ConsoleData>::new(&engine);
    if let Err(e) = crate::pg_wasi::link(&mut linker, &module) { return (500, error_body("runtime", &e.to_string())) }
    let done = |code: i64| {
        flush_out(id);
        let body = format!("{{\"exitCode\":{code},\"compileMs\":{compile_ms:.1},\"runMs\":{:.1}}}", crate::sys::now_ms() - t0);
        (200, body.into_bytes())
    };
    let fail = |e: wasmi::Error| match e.i32_exit_status() {
        Some(code) => done(code as i64),
        None => { flush_out(id); (500, error_body("runtime", &e.to_string())) }
    };
    store.set_fuel(u64::MAX / 4).ok();
    let instance = match linker.instantiate_and_start(&mut store, &module) { Ok(i) => i, Err(e) => return fail(e) };
    let start = match instance.get_typed_func::<(), ()>(&store, "_start") { Ok(f) => f, Err(_) => return done(0) };
    store.set_fuel(FUEL_SLICE).ok();
    let mut call = start.call_resumable(&mut store, ());
    loop {
        match call {
            Ok(TypedResumableCall::Finished(())) => return done(0),
            Ok(TypedResumableCall::OutOfFuel(more)) => {
                if stop.load(Ordering::Relaxed) {
                    flush_out(id);
                    return (500, error_body("stopped", "stopped"));
                }
                store.set_fuel(FUEL_SLICE).ok();
                call = more.resume(&mut store);
            }
            // proc_exit (and any host error) surfaces as a host trap here
            Ok(TypedResumableCall::HostTrap(t)) => {
                let e = t.host_error();
                return match e.i32_exit_status() {
                    Some(code) => done(code as i64),
                    None => { flush_out(id); (500, error_body("runtime", &e.to_string())) }
                };
            }
            Err(e) => return fail(e),
        }
    }
}

pub fn runner_run(fp: i64, fl: i64, ep: i64, el: i64) -> i64 {
    let (files_json, entry) = (crate::sys::string(fp, fl), crate::sys::string(ep, el));
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let id = spawn(move |id| {
        let t0 = crate::sys::now_ms();
        let wasm = match cs::compile_project_to_wasm(&files_json, &entry) {
            Ok(w) => w,
            Err(e) => return (500, error_body("compile", &e)),
        };
        let compile_ms = crate::sys::now_ms() - t0;
        post_result(id, 102, format!("{}", compile_ms.round() as i64).into_bytes());
        let files = parse_files(&files_json);
        if is_gui(&wasm) {
            // The UI thread starts it on the next frame (runner_gui_place).
            let (data, stdin) = data_files(&files);
            *PENDING.lock().unwrap() = Some((id, wasm, data, stdin));
            return (103, Vec::new());
        }
        let r = run_console(id, &wasm, &files, &stop2, compile_ms);
        STOPS.lock().unwrap().get_or_insert_with(HashMap::new).remove(&id);
        r
    });
    STOPS.lock().unwrap().get_or_insert_with(HashMap::new).insert(id, stop);
    id
}

pub fn runner_stop(id: i64) {
    if let Some(f) = STOPS.lock().unwrap().get_or_insert_with(HashMap::new).get(&id) {
        f.store(true, Ordering::Relaxed);
        return;
    }
    let pending = { let mut p = PENDING.lock().unwrap(); if p.as_ref().is_some_and(|x| x.0 == id) { p.take() } else { None } };
    let mut ended = pending.is_some();
    SESSION.with(|s| {
        let mut s = s.borrow_mut();
        if s.as_ref().is_some_and(|x| x.run_id == id) {
            if let Some(mut sess) = s.take() { sess.release(); }
            ended = true;
        }
    });
    if ended {
        flush_out(id);
        post_result(id, 500, error_body("stopped", "stopped"));
    }
}

// ── GUI programs (UI thread) ──

fn end_session(id: i64, end: End) {
    SESSION.with(|s| { if let Some(mut sess) = s.borrow_mut().take() { sess.release(); } });
    flush_out(id);
    match end {
        End::Exit(code) => post_result(id, 200, format!("{{\"exitCode\":{code},\"compileMs\":0,\"runMs\":0}}").into_bytes()),
        End::Error(e) => post_result(id, 500, error_body("runtime", &e)),
    }
}

/// For tests: the program's accessibility labels and rects, one per line.
/// Android (`debug.ceangal.gui_a11y` = 1): logged to logcat between
/// `gui-a11y-begin` / `gui-a11y-end` when it changes.
fn dump_a11y(sess: &Session) {
    let to_file = std::env::var("CEANGAL_GUI_A11Y").ok();
    let to_log = cfg!(target_os = "android") && crate::sys::test_flag("GUI_A11Y");
    if to_file.is_none() && !to_log { return }
    let text: String = sess.a11y().iter().map(|n| format!("{}\t{:.0}\t{:.0}\t{:.0}\t{:.0}\n", n.label, n.rect.0, n.rect.1, n.rect.2, n.rect.3)).collect();
    if let Some(path) = to_file {
        let _ = std::fs::write(path, &text);
    }
    if to_log {
        static LAST: Mutex<String> = Mutex::new(String::new());
        let mut last = LAST.lock().unwrap();
        if *last != text {
            crate::sys::log_line("gui-a11y-begin");
            for l in text.lines() { crate::sys::log_line(l); }
            crate::sys::log_line("gui-a11y-end");
            *last = text;
        }
    }
}

pub fn runner_gui_place(_x: f64, _y: f64, w: f64, h: f64, scale: f64) -> i64 {
    let pending = PENDING.lock().unwrap().take();
    if let Some((id, wasm, data, stdin)) = pending {
        match Session::new(id, &wasm, data, stdin) {
            Ok(s) => SESSION.with(|cell| *cell.borrow_mut() = Some(s)),
            Err(e) => { end_session(id, End::Error(e)); return 0 }
        }
    }
    if w <= 1.0 || h <= 1.0 { return 0 }
    let result = SESSION.with(|cell| {
        let mut cell = cell.borrow_mut();
        let sess = cell.as_mut()?;
        let id = sess.run_id;
        Some((id, sess.place(w, h, scale.max(0.5)).map(|tex| {
            if sess.wants_frame() { crate::sys::request_frame(); }
            if let Some(d) = sess.deadline() { crate::sys::request_frame_after(d - crate::sys::now_ms()); }
            dump_a11y(sess);
            tex
        })))
    });
    match result {
        None => 0,
        Some((_, Ok(tex))) => tex,
        Some((id, Err(end))) => { end_session(id, end); 0 }
    }
}

fn with_session(f: impl FnOnce(&mut Session) -> Result<i64, End>) -> i64 {
    let r = SESSION.with(|cell| {
        let mut cell = cell.borrow_mut();
        let sess = cell.as_mut()?;
        Some((sess.run_id, f(sess)))
    });
    crate::sys::request_frame();
    match r {
        None => 0,
        Some((_, Ok(v))) => v,
        Some((id, Err(end))) => { end_session(id, end); 0 }
    }
}

pub fn runner_gui_event(kind: i64, a: i64, b: i64, x: f64, y: f64, z: f64, w: f64) -> i64 {
    with_session(|s| s.dispatch(kind, a, b, x, y, z, w))
}

pub fn runner_gui_text(kind: i64, ptr: i64, len: i64, cursor: i64) -> i64 {
    let data = crate::sys::slice(ptr, len).to_vec();
    with_session(|s| s.with_data(&data, |s| s.dispatch(7, kind, cursor, 0.0, 0.0, 0.0, 0.0)))
}

pub fn runner_gui_ime(i: i64) -> f64 {
    SESSION.with(|cell| {
        let cell = cell.borrow();
        match cell.as_ref().and_then(|s| s.ime()) {
            Some((x, y, w, h)) => [x, y, w, h][i.clamp(0, 3) as usize],
            None => -1.0,
        }
    })
}
