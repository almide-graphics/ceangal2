//! `runner` namespace for natively built playgrounds (apps/playground/docs/runner.md).
//!
//! M2 ships the web runner; the native one (the compiler crate linked in,
//! programs run on an embedded wasm runtime) lands with M4. Until then every
//! request completes immediately with status 500 so the UI shows why.

#![allow(dead_code)]

use std::cell::RefCell;

thread_local! {
    static NEXT: RefCell<i64> = const { RefCell::new(1_000_000) };
    pub static RESULTS: RefCell<Vec<(i64, i64, Vec<u8>)>> = const { RefCell::new(Vec::new()) };
}

fn pending(msg: &str) -> i64 {
    let id = NEXT.with(|n| { let mut n = n.borrow_mut(); *n += 1; *n });
    let body = format!("{{\"phase\":\"native\",\"error\":\"{msg}\"}}").into_bytes();
    RESULTS.with(|r| r.borrow_mut().push((id, 500, body)));
    id
}

/// Results ready for delivery as event 10 (drained by the host loop).
pub fn take_results() -> Vec<(i64, i64, Vec<u8>)> {
    RESULTS.with(|r| std::mem::take(&mut *r.borrow_mut()))
}

const VERSION: &str = "native runner pending (M4)";

pub fn runner_version_len() -> i64 { VERSION.len() as i64 }
pub fn runner_version_read(ptr: i64, len: i64) -> i64 { crate::sys::fill(VERSION.as_bytes(), ptr, len) }
pub fn runner_check(files_ptr: i64, files_len: i64, entry_ptr: i64, entry_len: i64) -> i64 { let _ = (files_ptr, files_len, entry_ptr, entry_len); pending("check is not available natively yet") }
pub fn runner_run(files_ptr: i64, files_len: i64, entry_ptr: i64, entry_len: i64) -> i64 { let _ = (files_ptr, files_len, entry_ptr, entry_len); pending("run is not available natively yet") }
pub fn runner_rust(files_ptr: i64, files_len: i64, entry_ptr: i64, entry_len: i64) -> i64 { let _ = (files_ptr, files_len, entry_ptr, entry_len); pending("rust is not available natively yet") }
pub fn runner_ast(src_ptr: i64, src_len: i64) -> i64 { let _ = (src_ptr, src_len); pending("ast is not available natively yet") }
pub fn runner_stop(id: i64) { let _ = id; }
