//! `file` namespace — docs/abi.md §4.7. Picker requests are queued for the
//! host loop (system dialogs must run on the main thread); results arrive as
//! event 10. (Dialogs land with M4.)

#![allow(dead_code)]

use std::cell::RefCell;

#[derive(Clone, Debug)]
pub enum FileRequest {
    Open { id: i64, kind: i64 },
    Save { id: i64, name: String, data: Vec<u8> },
}

thread_local! {
    pub static FILES: RefCell<(i64, Vec<FileRequest>)> = const { RefCell::new((10_000, Vec::new())) };
}

pub fn file_open(kind: i64) -> i64 {
    FILES.with(|f| {
        let mut f = f.borrow_mut();
        f.0 += 1;
        let id = f.0;
        f.1.push(FileRequest::Open { id, kind });
        id
    })
}

pub fn file_save(name_ptr: i64, name_len: i64, ptr: i64, len: i64) -> i64 {
    let name = crate::sys::string(name_ptr, name_len);
    let data = crate::sys::slice(ptr, len).to_vec();
    FILES.with(|f| {
        let mut f = f.borrow_mut();
        f.0 += 1;
        let id = f.0;
        f.1.push(FileRequest::Save { id, name, data });
        id
    })
}

pub fn take_requests() -> Vec<FileRequest> {
    FILES.with(|f| std::mem::take(&mut f.borrow_mut().1))
}
