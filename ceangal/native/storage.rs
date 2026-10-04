//! `storage` namespace — docs/abi.md §4.6: a per-app key/value store kept as
//! one file per key under the app's data directory. `secret_*` share the
//! shape and live in the platform credential store (Keychain, Windows
//! Credential Manager, Secret Service) via `keyring`; headless runs, and
//! systems without a store, use a separate owner-only directory instead.

#![allow(dead_code)]

use std::path::PathBuf;

/// The app's identity for its data directory and keychain entries: set at
/// build time (`CEANGAL_APP_ID=… almide build`, see tools/build_native.sh),
/// overridable at run time for tests.
pub fn app_id() -> String {
    std::env::var("CEANGAL_APP_ID").ok()
        .or_else(|| option_env!("CEANGAL_APP_ID").map(str::to_string))
        .unwrap_or_else(|| "dev.almide.ceangal".to_string())
}

pub fn data_dir() -> PathBuf {
    if let Ok(d) = std::env::var("CEANGAL_DATA_DIR") {
        return d.into();
    }
    let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| ".".into());
    let base: PathBuf = if cfg!(target_os = "macos") {
        PathBuf::from(&home).join("Library/Application Support")
    } else if cfg!(target_os = "windows") {
        std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(&home))
    } else {
        std::env::var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(&home).join(".local/share"))
    };
    base.join(app_id())
}

fn key_path(kind: &str, key: &str) -> PathBuf {
    let mut name = String::new();
    for b in key.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' {
            name.push(b as char);
        } else {
            name.push_str(&format!("%{:02X}", b));
        }
    }
    data_dir().join(kind).join(name)
}

fn len(kind: &str, kp: i64, kl: i64) -> i64 {
    std::fs::metadata(key_path(kind, &crate::sys::string(kp, kl))).map_or(-1, |m| m.len() as i64)
}

fn read(kind: &str, kp: i64, kl: i64, dp: i64, dl: i64) -> i64 {
    match std::fs::read(key_path(kind, &crate::sys::string(kp, kl))) {
        Ok(d) => crate::sys::fill(&d, dp, dl),
        Err(_) => 0,
    }
}

fn write(kind: &str, kp: i64, kl: i64, p: i64, l: i64) {
    let path = key_path(kind, &crate::sys::string(kp, kl));
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
        #[cfg(unix)]
        if kind == "secrets" {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
    }
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, crate::sys::slice(p, l)).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

fn remove(kind: &str, kp: i64, kl: i64) {
    let _ = std::fs::remove_file(key_path(kind, &crate::sys::string(kp, kl)));
}

pub fn storage_len(key_ptr: i64, key_len: i64) -> i64 { len("kv", key_ptr, key_len) }
pub fn storage_read(key_ptr: i64, key_len: i64, dst_ptr: i64, dst_len: i64) -> i64 { read("kv", key_ptr, key_len, dst_ptr, dst_len) }
pub fn storage_write(key_ptr: i64, key_len: i64, ptr: i64, len_: i64) { write("kv", key_ptr, key_len, ptr, len_) }
pub fn storage_remove(key_ptr: i64, key_len: i64) { remove("kv", key_ptr, key_len) }
/// The keychain entry for `key`, unless this run should not touch it.
fn keychain(key: &str) -> Option<keyring::Entry> {
    if std::env::var_os("CEANGAL_HEADLESS").is_some() || std::env::var("CEANGAL_SECRETS").is_ok_and(|v| v == "file") {
        return None;
    }
    keyring::Entry::new(&app_id(), key).ok()
}

fn secret_get(key: &str) -> Option<Vec<u8>> {
    match keychain(key) {
        Some(e) => e.get_secret().ok(),
        None => std::fs::read(key_path("secrets", key)).ok(),
    }
}

pub fn secret_len(key_ptr: i64, key_len: i64) -> i64 {
    secret_get(&crate::sys::string(key_ptr, key_len)).map_or(-1, |v| v.len() as i64)
}
pub fn secret_read(key_ptr: i64, key_len: i64, dst_ptr: i64, dst_len: i64) -> i64 {
    secret_get(&crate::sys::string(key_ptr, key_len)).map_or(0, |v| crate::sys::fill(&v, dst_ptr, dst_len))
}
pub fn secret_write(key_ptr: i64, key_len: i64, ptr: i64, len_: i64) {
    let key = crate::sys::string(key_ptr, key_len);
    match keychain(&key) {
        Some(e) => { let _ = e.set_secret(crate::sys::slice(ptr, len_)); }
        None => write("secrets", key_ptr, key_len, ptr, len_),
    }
}
pub fn secret_remove(key_ptr: i64, key_len: i64) {
    let key = crate::sys::string(key_ptr, key_len);
    match keychain(&key) {
        Some(e) => { let _ = e.delete_credential(); }
        None => remove("secrets", key_ptr, key_len),
    }
}
