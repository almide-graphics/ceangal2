//! Clipboard, file dialogs and the keychain, per target. Desktop uses
//! arboard / rfd / keyring; Android and iOS fall back to an in-app
//! clipboard, app-private files and the app sandbox.

use std::path::PathBuf;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod imp {
    use std::path::PathBuf;

    pub struct Clipboard(arboard::Clipboard);

    impl Clipboard {
        pub fn new() -> Option<Self> { arboard::Clipboard::new().ok().map(Clipboard) }
        pub fn get_text(&mut self) -> Option<String> { self.0.get_text().ok() }
        pub fn set_text(&mut self, s: String) { let _ = self.0.set_text(s); }
    }

    pub fn save_dialog(name: &str, _downloads: &std::path::Path) -> Option<PathBuf> {
        rfd::FileDialog::new().set_file_name(name).save_file()
    }

    pub fn open_dialog() -> Option<PathBuf> {
        rfd::FileDialog::new().pick_file()
    }

    pub struct Keychain(keyring::Entry);

    impl Keychain {
        pub fn new(service: &str, key: &str) -> Option<Self> { keyring::Entry::new(service, key).ok().map(Keychain) }
        pub fn get(&self) -> Option<Vec<u8>> { self.0.get_secret().ok() }
        pub fn set(&self, v: &[u8]) { let _ = self.0.set_secret(v); }
        pub fn delete(&self) { let _ = self.0.delete_credential(); }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
mod imp {
    use std::path::PathBuf;

    /// In-app clipboard: copy / paste work between fields of this app.
    pub struct Clipboard(Option<String>);

    impl Clipboard {
        pub fn new() -> Option<Self> { Some(Clipboard(None)) }
        pub fn get_text(&mut self) -> Option<String> { self.0.clone() }
        pub fn set_text(&mut self, s: String) { self.0 = Some(s); }
    }

    /// No system save panel: the file goes to the app's downloads folder.
    pub fn save_dialog(name: &str, downloads: &std::path::Path) -> Option<PathBuf> {
        std::fs::create_dir_all(downloads).ok()?;
        Some(downloads.join(name))
    }

    pub fn open_dialog() -> Option<PathBuf> { None }

    /// The app sandbox already keeps its files private; secrets use them.
    pub struct Keychain;

    impl Keychain {
        pub fn new(_service: &str, _key: &str) -> Option<Self> { None }
        pub fn get(&self) -> Option<Vec<u8>> { None }
        pub fn set(&self, _v: &[u8]) {}
        pub fn delete(&self) {}
    }
}

pub use imp::{Clipboard, Keychain};

/// Where a save goes: a system dialog on desktop, `downloads` on mobile.
pub fn save_dialog(name: &str, downloads: &std::path::Path) -> Option<PathBuf> { imp::save_dialog(name, downloads) }

/// A file the user picks (None: cancelled, or no picker on this platform).
pub fn open_dialog() -> Option<PathBuf> { imp::open_dialog() }

/// Android: the window's insets in physical px (left, top, right, bottom) —
/// system bars, display cutout and the soft keyboard. Apps targeting API 35+
/// are always edge to edge, so the content rect alone does not show them.
#[cfg(target_os = "android")]
pub fn android_insets(vm: *mut std::ffi::c_void, activity: *mut std::ffi::c_void) -> Option<[i32; 4]> {
    use jni::objects::{JObject, JValue};
    let vm = unsafe { jni::JavaVM::from_raw(vm.cast()) }.ok()?;
    let mut env = vm.attach_current_thread_permanently().ok()?;
    let r = env.with_local_frame(16, |env| -> jni::errors::Result<Option<[i32; 4]>> {
        let act = unsafe { JObject::from_raw(activity as jni::sys::jobject) };
        let window = env.call_method(&act, "getWindow", "()Landroid/view/Window;", &[])?.l()?;
        let decor = env.call_method(&window, "getDecorView", "()Landroid/view/View;", &[])?.l()?;
        let wi = env.call_method(&decor, "getRootWindowInsets", "()Landroid/view/WindowInsets;", &[])?.l()?;
        if wi.is_null() {
            return Ok(None);
        }
        let mut mask = 0;
        for name in ["systemBars", "displayCutout", "ime"] {
            mask |= env.call_static_method("android/view/WindowInsets$Type", name, "()I", &[])?.i()?;
        }
        let ins = env.call_method(&wi, "getInsets", "(I)Landroid/graphics/Insets;", &[JValue::Int(mask)])?.l()?;
        let mut out = [0; 4];
        for (i, f) in ["left", "top", "right", "bottom"].iter().enumerate() {
            out[i] = env.get_field(&ins, f, "I")?.i()?;
        }
        Ok(Some(out))
    });
    match r {
        Ok(v) => v,
        Err(_) => {
            let _ = env.exception_clear();
            None
        }
    }
}

/// Android: the launching intent's data URI (a deep link), if any.
#[cfg(target_os = "android")]
pub fn android_intent_data(vm: *mut std::ffi::c_void, activity: *mut std::ffi::c_void) -> Option<String> {
    use jni::objects::{JObject, JString};
    let vm = unsafe { jni::JavaVM::from_raw(vm.cast()) }.ok()?;
    let mut env = vm.attach_current_thread_permanently().ok()?;
    let r = env.with_local_frame(8, |env| -> jni::errors::Result<Option<String>> {
        let act = unsafe { JObject::from_raw(activity as jni::sys::jobject) };
        let intent = env.call_method(&act, "getIntent", "()Landroid/content/Intent;", &[])?.l()?;
        if intent.is_null() {
            return Ok(None);
        }
        let data = env.call_method(&intent, "getDataString", "()Ljava/lang/String;", &[])?.l()?;
        if data.is_null() {
            return Ok(None);
        }
        Ok(Some(env.get_string(&JString::from(data))?.into()))
    });
    r.unwrap_or_else(|_| { let _ = env.exception_clear(); None })
}
