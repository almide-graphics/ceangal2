//! `sys` namespace — docs/abi.md §4.1 — for natively built apps.
//!
//! The state here belongs to the host loop in `host.rs`: the event data
//! buffer it fills before each dispatch, the frame request flag it polls,
//! and the cursor/title it applies to the window.

#![allow(dead_code)]

use std::cell::RefCell;
use std::time::Instant;

pub const ABI_VERSION: i64 = 1;

pub struct SysState {
    pub start: Instant,
    pub event_data: Vec<u8>,
    pub frame_requested: bool,
    pub cursor: Option<i64>,
    pub title: Option<String>,
    pub exit_code: Option<i64>,
    pub open_urls: Vec<String>,
}

thread_local! {
    pub static STATE: RefCell<SysState> = RefCell::new(SysState {
        start: Instant::now(),
        event_data: Vec::new(),
        frame_requested: true,
        cursor: None,
        title: None,
        exit_code: None,
        open_urls: Vec::new(),
    });
}

pub(crate) fn slice<'a>(ptr: i64, len: i64) -> &'a [u8] {
    if ptr == 0 || len <= 0 {
        &[]
    } else {
        unsafe { std::slice::from_raw_parts(ptr as usize as *const u8, len as usize) }
    }
}

pub(crate) fn slice_mut<'a>(ptr: i64, len: i64) -> &'a mut [u8] {
    if ptr == 0 || len <= 0 {
        &mut []
    } else {
        unsafe { std::slice::from_raw_parts_mut(ptr as usize as *mut u8, len as usize) }
    }
}

pub(crate) fn string(ptr: i64, len: i64) -> String {
    String::from_utf8_lossy(slice(ptr, len)).into_owned()
}

/// Copy `src` into the guest buffer; returns the bytes written.
pub(crate) fn fill(src: &[u8], ptr: i64, len: i64) -> i64 {
    let dst = slice_mut(ptr, len);
    let n = src.len().min(dst.len());
    dst[..n].copy_from_slice(&src[..n]);
    n as i64
}

pub fn set_event_data(data: &[u8]) {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.event_data.clear();
        s.event_data.extend_from_slice(data);
    });
}

pub fn take_frame_request() -> bool {
    STATE.with(|s| std::mem::replace(&mut s.borrow_mut().frame_requested, false))
}

// ── assets ──

/// Directories searched for bundled assets, in order.
pub fn asset_dirs() -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(d) = std::env::var("CEANGAL_ASSETS") {
        dirs.push(d.into());
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            dirs.push(dir.join("assets"));
            // macOS bundle: Contents/MacOS/<exe> -> Contents/Resources/assets
            dirs.push(dir.join("../Resources/assets"));
        }
    }
    dirs.push("assets".into());
    dirs
}

fn read_asset(name: &str) -> Option<Vec<u8>> {
    if name.contains("..") {
        return None;
    }
    asset_dirs().into_iter().find_map(|d| std::fs::read(d.join(name)).ok())
}

thread_local! {
    static ASSET_CACHE: RefCell<Option<(String, Vec<u8>)>> = const { RefCell::new(None) };
}

fn with_asset<R>(name: &str, f: impl FnOnce(Option<&[u8]>) -> R) -> R {
    ASSET_CACHE.with(|c| {
        let mut c = c.borrow_mut();
        if c.as_ref().map(|(n, _)| n.as_str()) != Some(name) {
            *c = read_asset(name).map(|d| (name.to_string(), d));
        }
        f(c.as_ref().map(|(_, d)| d.as_slice()))
    })
}

// ── @extern(rust, "crate::sys", …) ──

pub fn abi_version() -> i64 { ABI_VERSION }

pub fn run() {
    crate::host::run();
}

pub fn request_frame() {
    STATE.with(|s| s.borrow_mut().frame_requested = true);
}

pub fn now_ms() -> f64 {
    STATE.with(|s| s.borrow().start.elapsed().as_secs_f64() * 1000.0)
}

pub fn log(ptr: i64, len: i64) {
    eprintln!("{}", string(ptr, len));
}

pub fn event_len() -> i64 {
    STATE.with(|s| s.borrow().event_data.len() as i64)
}

pub fn event_read(ptr: i64, len: i64) -> i64 {
    STATE.with(|s| fill(&s.borrow().event_data, ptr, len))
}

pub fn platform() -> i64 {
    if cfg!(target_os = "ios") { 5 }
    else if cfg!(target_os = "android") { 6 }
    else if cfg!(target_os = "macos") { 2 }
    else if cfg!(target_os = "windows") { 3 }
    else { 4 }
}

pub fn set_cursor(kind: i64) {
    STATE.with(|s| s.borrow_mut().cursor = Some(kind));
}

pub fn set_title(ptr: i64, len: i64) {
    let t = string(ptr, len);
    STATE.with(|s| s.borrow_mut().title = Some(t));
}

pub fn open_url(ptr: i64, len: i64) {
    let u = string(ptr, len);
    STATE.with(|s| s.borrow_mut().open_urls.push(u));
}

pub fn asset_len(name_ptr: i64, name_len: i64) -> i64 {
    with_asset(&string(name_ptr, name_len), |d| d.map_or(-1, |d| d.len() as i64))
}

pub fn asset_read(name_ptr: i64, name_len: i64, dst_ptr: i64, dst_len: i64) -> i64 {
    with_asset(&string(name_ptr, name_len), |d| d.map_or(0, |d| fill(d, dst_ptr, dst_len)))
}

pub fn exit(code: i64) {
    STATE.with(|s| s.borrow_mut().exit_code = Some(code));
}
