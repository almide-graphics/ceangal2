//! An app's own Rust (ceangal.toml [native] dir): `crate::twice`. The web
//! build gets the same function from web/boot.js.

pub fn twice_int(n: i64) -> i64 { n * 2 }

/// Strings cross as (ptr, len) so the same declaration works on the web.
pub fn twice_text_len(ptr: i64, len: i64) -> i64 {
    let s = crate::sys::string(ptr, len);
    (s.chars().count() * 2) as i64
}
