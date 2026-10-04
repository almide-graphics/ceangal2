//! `text_input` namespace — docs/abi.md §4.3. The host loop applies the
//! requested IME state to the window (and soft keyboard on mobile).

#![allow(dead_code)]

use std::cell::RefCell;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ImeRequest {
    pub active: bool,
    pub rect: (f64, f64, f64, f64),
}

thread_local! {
    pub static IME: RefCell<(ImeRequest, bool)> = const { RefCell::new((ImeRequest { active: false, rect: (0.0, 0.0, 0.0, 0.0) }, false)) };
}

/// The latest request if it changed since the last call.
pub fn take_change() -> Option<ImeRequest> {
    IME.with(|s| {
        let mut s = s.borrow_mut();
        if s.1 { s.1 = false; Some(s.0) } else { None }
    })
}

fn set(active: bool, x: f64, y: f64, w: f64, h: f64) {
    IME.with(|s| {
        let mut s = s.borrow_mut();
        let r = ImeRequest { active, rect: (x, y, w, h) };
        if s.0 != r { s.0 = r; s.1 = true; }
    });
}

pub fn ime_begin(x: f64, y: f64, w: f64, h: f64) { set(true, x, y, w, h) }
pub fn ime_update(x: f64, y: f64, w: f64, h: f64) { set(true, x, y, w, h) }
pub fn ime_end() { set(false, 0.0, 0.0, 0.0, 0.0) }
