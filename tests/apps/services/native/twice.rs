//! An app's own Rust (ceangal.toml [native] dir): `crate::twice`. The web
//! build gets the same function from web/boot.js.

pub fn twice_int(n: i64) -> i64 { n * 2 }

/// The text crosses as an ffi.Region (ADR-0031): web/boot.js and this both
/// get its (ptr, len) pair.
pub fn twice_text_len(text_ptr: *mut u8, text_len: usize) -> i64 {
    let s = crate::sys::string(text_ptr as i64, text_len as i64);
    (s.chars().count() * 2) as i64
}
