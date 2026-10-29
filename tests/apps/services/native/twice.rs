//! An app's own Rust (ceangal.toml [native] dir): `crate::twice`. The web
//! build gets the same function from web/boot.js.

pub fn twice_int(n: i64) -> i64 { n * 2 }

/// The text crosses as an ffi.Region (ADR-0031): web/boot.js gets its
/// (ptr, len) pair, this gets the Region and reads the same pair from it.
pub fn twice_text_len(text: impl std::borrow::Borrow<crate::Region>) -> i64 {
    let text = text.borrow();
    let s = crate::sys::string(text.base as i64, text.len);
    (s.chars().count() * 2) as i64
}
