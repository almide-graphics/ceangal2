//! `clipboard` namespace — docs/abi.md §4.5. Writes are queued for the host
//! loop, which owns the platform clipboard; paste is delivered as a text event.

#![allow(dead_code)]

use std::cell::RefCell;

thread_local! {
    pub static PENDING_WRITE: RefCell<Option<String>> = const { RefCell::new(None) };
}

pub fn clipboard_write(ptr: i64, len: i64) {
    let s = crate::sys::string(ptr, len);
    PENDING_WRITE.with(|p| *p.borrow_mut() = Some(s));
}

pub fn take_write() -> Option<String> {
    PENDING_WRITE.with(|p| p.borrow_mut().take())
}
