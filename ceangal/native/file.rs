//! `file` namespace — docs/abi.md §4.7. Picker requests are queued for the
//! host loop (system dialogs must run on the main thread); results arrive as
//! event 10. Dialogs come from `ceangal_platform`: the desktop's save / open
//! panels, the share sheet and document picker on iOS, Downloads on Android.

#![allow(dead_code)]

use std::cell::RefCell;

#[derive(Clone, Debug)]
pub enum FileRequest {
    Open { id: i64, kind: i64 },
    Save { id: i64, name: String, data: Vec<u8> },
}

thread_local! {
    pub static FILES: RefCell<(i64, Vec<FileRequest>)> = const { RefCell::new((0, Vec::new())) };
}

pub fn file_open(kind: i64) -> i64 {
    FILES.with(|f| {
        let mut f = f.borrow_mut();
        let id = crate::sys::next_request_id();
        f.1.push(FileRequest::Open { id, kind });
        id
    })
}

pub fn file_save(name_ptr: i64, name_len: i64, ptr: i64, len: i64) -> i64 {
    let name = crate::sys::string(name_ptr, name_len);
    let data = crate::sys::slice(ptr, len).to_vec();
    FILES.with(|f| {
        let mut f = f.borrow_mut();
        let id = crate::sys::next_request_id();
        f.1.push(FileRequest::Save { id, name, data });
        id
    })
}

/// Requests waiting for the host loop.
pub fn take_requests() -> Vec<FileRequest> {
    FILES.with(|f| std::mem::take(&mut f.borrow_mut().1))
}

/// Perform queued requests. `interactive`: system dialogs (main thread);
/// otherwise (headless) saves go to `$CEANGAL_DOWNLOADS` and opens read
/// `$CEANGAL_OPEN_FILE`. Results: 200 + path (save) or contents (open);
/// 499 when the user cancels; 0 + message on failure.
pub fn perform(interactive: bool) {
    for req in take_requests() {
        // Phones: the platform's own flows (share sheet, Downloads, document
        // picker), answered asynchronously.
        #[cfg(any(target_os = "android", target_os = "ios"))]
        if interactive {
            crate::sys::begin_async();
            match req {
                FileRequest::Save { id, name, data } => {
                    let downloads = crate::storage::data_dir().join("Downloads");
                    ceangal_platform::mobile_save(&name, &data, &downloads, Box::new(move |s, b| crate::sys::finish_async(id, s, Some(b))));
                }
                FileRequest::Open { id, kind: _ } => {
                    ceangal_platform::mobile_open(Box::new(move |s, b| crate::sys::finish_async(id, s, Some(b))));
                }
            }
            continue;
        }
        match req {
            FileRequest::Save { id, name, data } => {
                let path = if interactive {
                    ceangal_platform::save_dialog(&name, &crate::storage::data_dir().join("Downloads"))
                } else {
                    std::env::var_os("CEANGAL_DOWNLOADS").map(|d| std::path::PathBuf::from(d).join(&name))
                };
                crate::sys::begin_async();
                match path {
                    None => crate::sys::finish_async(id, 499, Some(Vec::new())),
                    Some(p) => match std::fs::write(&p, &data) {
                        Ok(()) => crate::sys::finish_async(id, 200, Some(p.to_string_lossy().into_owned().into_bytes())),
                        Err(e) => crate::sys::finish_async(id, 0, Some(e.to_string().into_bytes())),
                    },
                }
            }
            FileRequest::Open { id, kind: _ } => {
                let path = if interactive {
                    ceangal_platform::open_dialog()
                } else {
                    std::env::var_os("CEANGAL_OPEN_FILE").map(std::path::PathBuf::from)
                };
                crate::sys::begin_async();
                match path {
                    None => crate::sys::finish_async(id, 499, Some(Vec::new())),
                    Some(p) => match std::fs::read(&p) {
                        Ok(b) => crate::sys::finish_async(id, 200, Some(b)),
                        Err(e) => crate::sys::finish_async(id, 0, Some(e.to_string().into_bytes())),
                    },
                }
            }
        }
    }
}
