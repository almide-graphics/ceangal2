//! `runner` namespace for natively built playgrounds (apps/playground/docs/runner.md).
//!
//! M2 ships the web runner; the native one (the compiler crate linked in,
//! programs run on an embedded wasm runtime) lands with M4. Until then every
//! request completes immediately with status 500 so the UI shows why.

#![allow(dead_code)]

fn pending(msg: &str) -> i64 {
    let id = crate::sys::next_request_id();
    let body = format!("{{\"phase\":\"native\",\"error\":\"{msg}\"}}").into_bytes();
    crate::sys::begin_async();
    crate::sys::finish_async(id, 500, Some(body));
    id
}

const VERSION: &str = "native runner pending (M4)";

pub fn runner_version_len() -> i64 { VERSION.len() as i64 }
pub fn runner_version_read(ptr: i64, len: i64) -> i64 { crate::sys::fill(VERSION.as_bytes(), ptr, len) }
pub fn runner_check(files_ptr: i64, files_len: i64, entry_ptr: i64, entry_len: i64) -> i64 { let _ = (files_ptr, files_len, entry_ptr, entry_len); pending("check is not available natively yet") }
pub fn runner_run(files_ptr: i64, files_len: i64, entry_ptr: i64, entry_len: i64) -> i64 { let _ = (files_ptr, files_len, entry_ptr, entry_len); pending("run is not available natively yet") }
pub fn runner_rust(files_ptr: i64, files_len: i64, entry_ptr: i64, entry_len: i64) -> i64 { let _ = (files_ptr, files_len, entry_ptr, entry_len); pending("rust is not available natively yet") }
pub fn runner_ast(src_ptr: i64, src_len: i64) -> i64 { let _ = (src_ptr, src_len); pending("ast is not available natively yet") }
pub fn runner_stop(id: i64) { let _ = id; }
