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

    /// The system clipboard (UIPasteboard / ClipboardManager); what the app
    /// copied last stays readable here should the system refuse a read.
    pub struct Clipboard(Option<String>);

    impl Clipboard {
        pub fn new() -> Option<Self> { Some(Clipboard(None)) }
        pub fn get_text(&mut self) -> Option<String> { super::mobile::clipboard_get().or_else(|| self.0.clone()) }
        pub fn set_text(&mut self, s: String) {
            super::mobile::clipboard_set(&s);
            self.0 = Some(s);
        }
    }

    /// No system save panel: the file goes to the app's downloads folder.
    pub fn save_dialog(name: &str, downloads: &std::path::Path) -> Option<PathBuf> {
        std::fs::create_dir_all(downloads).ok()?;
        Some(downloads.join(name))
    }

    pub fn open_dialog() -> Option<PathBuf> { None }

    /// Android: the app sandbox already keeps its files private; secrets use them.
    #[cfg(target_os = "android")]
    pub struct Keychain;

    #[cfg(target_os = "android")]
    impl Keychain {
        pub fn new(_service: &str, _key: &str) -> Option<Self> { None }
        pub fn get(&self) -> Option<Vec<u8>> { None }
        pub fn set(&self, _v: &[u8]) {}
        pub fn delete(&self) {}
    }

    /// iOS: a generic password in the app's keychain.
    #[cfg(target_os = "ios")]
    pub struct Keychain(String, String);

    #[cfg(target_os = "ios")]
    impl Keychain {
        pub fn new(service: &str, key: &str) -> Option<Self> { Some(Keychain(service.into(), key.into())) }
        pub fn get(&self) -> Option<Vec<u8>> { security_framework::passwords::get_generic_password(&self.0, &self.1).ok() }
        pub fn set(&self, v: &[u8]) { let _ = security_framework::passwords::set_generic_password(&self.0, &self.1, v); }
        pub fn delete(&self) { let _ = security_framework::passwords::delete_generic_password(&self.0, &self.1); }
    }
}

pub use imp::{Clipboard, Keychain};

/// A result for an asynchronous request: (status, body), as docs/abi.md §4.7
/// (200 done, 499 cancelled, 0 failed with the reason as the body).
pub type Done = Box<dyn FnOnce(i64, Vec<u8>) + Send>;

/// Phones: offer `data` as a file named `name`. iOS: the share sheet (Save
/// to Files, AirDrop, Mail…); Android: the shared Downloads folder (API 29+,
/// the app's own Downloads folder before).
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn mobile_save(name: &str, data: &[u8], downloads: &std::path::Path, done: Done) { mobile::save(name, data, downloads, done) }

/// Phones: a file the user picks, its bytes. iOS: the document picker;
/// Android: the system picker (ACTION_OPEN_DOCUMENT) through
/// dev.ceangal.PickerActivity.
#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn mobile_open(done: Done) { mobile::open(done) }

/// Android: AccessKit for TalkBack, on NativeActivity's content view. The
/// handlers run on Android's UI thread; the host answers through its event
/// loop (activation: render and `update_if_active` with the whole tree).
#[cfg(target_os = "android")]
pub struct AndroidA11y(accesskit_android::InjectingAdapter);

#[cfg(target_os = "android")]
impl AndroidA11y {
    pub fn new(
        activation: impl 'static + accesskit::ActivationHandler + Send,
        action: impl 'static + accesskit::ActionHandler + Send,
    ) -> Option<Self> {
        mobile::content_view(|env, view| accesskit_android::InjectingAdapter::new(env, view, activation, action)).map(AndroidA11y)
    }

    pub fn update_if_active(&mut self, f: impl FnOnce() -> accesskit::TreeUpdate) { self.0.update_if_active(f) }
}

/// Android: the VM and activity, for the services above (the host calls this
/// once at start).
#[cfg(target_os = "android")]
pub fn android_init(vm: *mut std::ffi::c_void, activity: *mut std::ffi::c_void) { mobile::init(vm, activity) }

#[cfg(target_os = "android")]
mod mobile {
    use jni::objects::{JObject, JValue};
    use std::sync::atomic::{AtomicPtr, Ordering};

    static VM: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());
    static ACT: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());

    pub fn init(vm: *mut std::ffi::c_void, activity: *mut std::ffi::c_void) {
        VM.store(vm, Ordering::SeqCst);
        ACT.store(activity, Ordering::SeqCst);
    }

    fn with_env<R>(f: impl FnOnce(&mut jni::JNIEnv, &JObject) -> jni::errors::Result<R>) -> Option<R> {
        let (vm, act) = (VM.load(Ordering::SeqCst), ACT.load(Ordering::SeqCst));
        if vm.is_null() || act.is_null() { return None }
        let vm = unsafe { jni::JavaVM::from_raw(vm.cast()) }.ok()?;
        let mut env = vm.attach_current_thread_permanently().ok()?;
        let r = env.with_local_frame(32, |env| {
            let act = unsafe { JObject::from_raw(act as jni::sys::jobject) };
            f(env, &act)
        });
        match r {
            Ok(v) => Some(v),
            Err(_) => { let _ = env.exception_clear(); None }
        }
    }

    /// `f` with the activity's content view: the NativeContentView inside
    /// android.R.id.content (the view input and accessibility go to).
    pub fn content_view<R>(f: impl FnOnce(&mut jni::JNIEnv, &JObject) -> R) -> Option<R> {
        let mut f = Some(f);
        with_env(|env, act| {
            let window = env.call_method(act, "getWindow", "()Landroid/view/Window;", &[])?.l()?;
            let decor = env.call_method(&window, "getDecorView", "()Landroid/view/View;", &[])?.l()?;
            let content_id = env.get_static_field("android/R$id", "content", "I")?.i()?;
            let content = env.call_method(&decor, "findViewById", "(I)Landroid/view/View;", &[JValue::Int(content_id)])?.l()?;
            if content.is_null() { return Ok(None) }
            let n = env.call_method(&content, "getChildCount", "()I", &[])?.i()?;
            let view = if n > 0 { env.call_method(&content, "getChildAt", "(I)Landroid/view/View;", &[JValue::Int(0)])?.l()? } else { content };
            Ok(Some((f.take().unwrap())(env, &view)))
        }).flatten()
    }

    fn clipboard_manager<'a>(env: &mut jni::JNIEnv<'a>, act: &JObject) -> jni::errors::Result<JObject<'a>> {
        let name = env.new_string("clipboard")?;
        env.call_method(act, "getSystemService", "(Ljava/lang/String;)Ljava/lang/Object;", &[JValue::Object(&name)])?.l()
    }

    pub fn clipboard_set(s: &str) {
        with_env(|env, act| {
            let cm = clipboard_manager(env, act)?;
            let label = env.new_string("text")?;
            let text = env.new_string(s)?;
            let clip = env.call_static_method("android/content/ClipData", "newPlainText",
                "(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Landroid/content/ClipData;",
                &[JValue::Object(&label), JValue::Object(&text)])?.l()?;
            env.call_method(&cm, "setPrimaryClip", "(Landroid/content/ClipData;)V", &[JValue::Object(&clip)])?;
            Ok(())
        });
    }

    pub fn clipboard_get() -> Option<String> {
        with_env(|env, act| {
            let cm = clipboard_manager(env, act)?;
            let clip = env.call_method(&cm, "getPrimaryClip", "()Landroid/content/ClipData;", &[])?.l()?;
            if clip.is_null() { return Ok(None) }
            let item = env.call_method(&clip, "getItemAt", "(I)Landroid/content/ClipData$Item;", &[JValue::Int(0)])?.l()?;
            let cs = env.call_method(&item, "coerceToText", "(Landroid/content/Context;)Ljava/lang/CharSequence;", &[JValue::Object(act)])?.l()?;
            let s = env.call_method(&cs, "toString", "()Ljava/lang/String;", &[])?.l()?;
            Ok(Some(env.get_string(&jni::objects::JString::from(s))?.into()))
        }).flatten()
    }

    fn sdk_int(env: &mut jni::JNIEnv) -> jni::errors::Result<i32> {
        env.get_static_field("android/os/Build$VERSION", "SDK_INT", "I")?.i()
    }

    pub fn save(name: &str, data: &[u8], downloads: &std::path::Path, done: super::Done) {
        // Android 10+: the shared Downloads folder through MediaStore (no permission needed)
        let saved = with_env(|env, act| {
            if sdk_int(env)? < 29 { return Ok(None) }
            let values = env.new_object("android/content/ContentValues", "()V", &[])?;
            for (k, v) in [("_display_name", name), ("relative_path", "Download/")] {
                let (k, v) = (env.new_string(k)?, env.new_string(v)?);
                env.call_method(&values, "put", "(Ljava/lang/String;Ljava/lang/String;)V", &[JValue::Object(&k), JValue::Object(&v)])?;
            }
            let resolver = env.call_method(act, "getContentResolver", "()Landroid/content/ContentResolver;", &[])?.l()?;
            let collection = env.get_static_field("android/provider/MediaStore$Downloads", "EXTERNAL_CONTENT_URI", "Landroid/net/Uri;")?.l()?;
            let uri = env.call_method(&resolver, "insert", "(Landroid/net/Uri;Landroid/content/ContentValues;)Landroid/net/Uri;",
                &[JValue::Object(&collection), JValue::Object(&values)])?.l()?;
            if uri.is_null() { return Ok(None) }
            let out = env.call_method(&resolver, "openOutputStream", "(Landroid/net/Uri;)Ljava/io/OutputStream;", &[JValue::Object(&uri)])?.l()?;
            let bytes = env.byte_array_from_slice(data)?;
            env.call_method(&out, "write", "([B)V", &[JValue::Object(&bytes)])?;
            env.call_method(&out, "close", "()V", &[])?;
            Ok(Some(format!("Download/{name}")))
        }).flatten();
        match saved {
            Some(path) => done(200, path.into_bytes()),
            None => {
                // before Android 10 (or if MediaStore refused): the app's own folder
                let p = downloads.join(name);
                match std::fs::create_dir_all(downloads).and_then(|_| std::fs::write(&p, data)) {
                    Ok(()) => done(200, p.to_string_lossy().into_owned().into_bytes()),
                    Err(e) => done(0, e.to_string().into_bytes()),
                }
            }
        }
    }

    /// The open request waiting for dev.ceangal.PickerActivity's answer.
    static PENDING: std::sync::Mutex<Option<super::Done>> = std::sync::Mutex::new(None);
    static REGISTERED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    /// The system picker through dev.ceangal.PickerActivity (in the app's
    /// dex, from ceangal/android): a NativeActivity cannot receive an
    /// activity result, so that activity takes it and calls `picked`.
    pub fn open(done: super::Done) {
        // a second request replaces the first, which is cancelled
        if let Some(prev) = PENDING.lock().unwrap().replace(done) { prev(499, Vec::new()) }
        let started = with_env(|env, act| {
            // the app's class loader (a native thread's FindClass only sees the system's)
            let loader = env.call_method(act, "getClassLoader", "()Ljava/lang/ClassLoader;", &[])?.l()?;
            let name = env.new_string("dev.ceangal.PickerActivity")?;
            let cls = jni::objects::JClass::from(env.call_method(&loader, "loadClass", "(Ljava/lang/String;)Ljava/lang/Class;", &[JValue::Object(&name)])?.l()?);
            if !REGISTERED.swap(true, Ordering::SeqCst) {
                env.register_native_methods(&cls, &[jni::NativeMethod {
                    name: "picked".into(),
                    sig: "(ILjava/lang/String;[B)V".into(),
                    fn_ptr: picked as *mut std::ffi::c_void,
                }])?;
            }
            let intent = env.new_object("android/content/Intent", "(Landroid/content/Context;Ljava/lang/Class;)V",
                &[JValue::Object(act), JValue::Object(&cls)])?;
            let (k, v) = (env.new_string("type")?, env.new_string("*/*")?);
            env.call_method(&intent, "putExtra", "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;",
                &[JValue::Object(&k), JValue::Object(&v)])?;
            env.call_method(act, "startActivity", "(Landroid/content/Intent;)V", &[JValue::Object(&intent)])?;
            Ok(())
        });
        if started.is_none() {
            REGISTERED.store(false, Ordering::SeqCst);
            if let Some(done) = PENDING.lock().unwrap().take() { done(0, b"the file picker could not start".to_vec()) }
        }
    }

    /// PickerActivity.picked(status, name, data): 200 with the file, 499
    /// cancelled, 0 with the reason.
    extern "system" fn picked<'local>(mut env: jni::JNIEnv<'local>, _cls: jni::objects::JClass<'local>, status: jni::sys::jint,
                                      _name: jni::objects::JString<'local>, data: jni::objects::JByteArray<'local>) {
        let bytes = env.convert_byte_array(&data).unwrap_or_default();
        if let Some(done) = PENDING.lock().unwrap().take() { done(status as i64, bytes) }
    }
}

#[cfg(target_os = "ios")]
mod mobile {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, NSObject};
    use objc2::{class, define_class, msg_send, ClassType};
    use std::sync::Mutex;

    fn ns_string(s: &str) -> *mut AnyObject {
        let c = std::ffi::CString::new(s.replace('\0', "")).unwrap_or_default();
        unsafe { msg_send![class!(NSString), stringWithUTF8String: c.as_ptr()] }
    }

    fn rust_string(ns: *mut AnyObject) -> Option<String> {
        if ns.is_null() { return None }
        let p: *const std::ffi::c_char = unsafe { msg_send![ns, UTF8String] };
        if p.is_null() { None } else { Some(unsafe { std::ffi::CStr::from_ptr(p) }.to_string_lossy().into_owned()) }
    }

    pub fn clipboard_set(s: &str) {
        unsafe {
            let pb: *mut AnyObject = msg_send![class!(UIPasteboard), generalPasteboard];
            let _: () = msg_send![pb, setString: ns_string(s)];
        }
    }

    pub fn clipboard_get() -> Option<String> {
        unsafe {
            let pb: *mut AnyObject = msg_send![class!(UIPasteboard), generalPasteboard];
            let s: *mut AnyObject = msg_send![pb, string];
            rust_string(s)
        }
    }

    /// The view controller to present over (winit's root).
    fn root() -> Option<*mut AnyObject> {
        unsafe {
            let app: *mut AnyObject = msg_send![class!(UIApplication), sharedApplication];
            let windows: *mut AnyObject = msg_send![app, windows];
            let n: usize = msg_send![windows, count];
            for i in 0..n {
                let w: *mut AnyObject = msg_send![windows, objectAtIndex: i];
                let key: Bool = msg_send![w, isKeyWindow];
                if key.as_bool() || i == n - 1 {
                    let vc: *mut AnyObject = msg_send![w, rootViewController];
                    if !vc.is_null() { return Some(vc) }
                }
            }
            None
        }
    }

    /// iPad presents sheets as popovers, which need an anchor.
    unsafe fn anchor(vc: *mut AnyObject, over: *mut AnyObject) {
        let pop: *mut AnyObject = msg_send![vc, popoverPresentationController];
        if pop.is_null() { return }
        let view: *mut AnyObject = msg_send![over, view];
        let _: () = msg_send![pop, setSourceView: view];
    }

    pub fn save(name: &str, data: &[u8], _downloads: &std::path::Path, done: super::Done) {
        let dir = std::env::temp_dir().join("ceangal-share");
        let path = dir.join(name);
        if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&path, data)) {
            return done(0, e.to_string().into_bytes());
        }
        let Some(over) = root() else { return done(0, b"no window to present the share sheet over".to_vec()) };
        let done = Mutex::new(Some(done));
        let shown = path.to_string_lossy().into_owned();
        unsafe {
            let url: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: ns_string(&shown)];
            let items: *mut AnyObject = msg_send![class!(NSArray), arrayWithObject: url];
            let vc: *mut AnyObject = msg_send![class!(UIActivityViewController), alloc];
            let null: *mut AnyObject = std::ptr::null_mut();
            let vc: *mut AnyObject = msg_send![vc, initWithActivityItems: items, applicationActivities: null];
            let block = block2::RcBlock::new(move |_kind: *mut AnyObject, completed: Bool, _items: *mut AnyObject, _err: *mut AnyObject| {
                if let Some(d) = done.lock().unwrap().take() {
                    if completed.as_bool() { d(200, shown.clone().into_bytes()) } else { d(499, Vec::new()) }
                }
            });
            let _: () = msg_send![vc, setCompletionWithItemsHandler: &*block];
            anchor(vc, over);
            let _: () = msg_send![over, presentViewController: vc, animated: Bool::YES, completion: null];
        }
    }

    static PICKED: Mutex<Option<super::Done>> = Mutex::new(None);

    define_class!(
        // SAFETY: NSObject has no subclassing requirements; no Drop.
        #[unsafe(super(NSObject))]
        #[name = "CeangalDocumentPickerDelegate"]
        struct PickerDelegate;

        impl PickerDelegate {
            #[unsafe(method(documentPicker:didPickDocumentsAtURLs:))]
            fn did_pick(&self, _picker: *mut AnyObject, urls: *mut AnyObject) {
                let Some(done) = PICKED.lock().unwrap().take() else { return };
                let url: *mut AnyObject = unsafe { msg_send![urls, firstObject] };
                let path = if url.is_null() { None } else { rust_string(unsafe { msg_send![url, path] }) };
                match path.map(|p| std::fs::read(p)) {
                    Some(Ok(b)) => done(200, b),
                    Some(Err(e)) => done(0, e.to_string().into_bytes()),
                    None => done(499, Vec::new()),
                }
            }

            #[unsafe(method(documentPickerWasCancelled:))]
            fn cancelled(&self, _picker: *mut AnyObject) {
                if let Some(done) = PICKED.lock().unwrap().take() { done(499, Vec::new()) }
            }
        }
    );

    pub fn open(done: super::Done) {
        let Some(over) = root() else { return done(0, b"no window to present the picker over".to_vec()) };
        *PICKED.lock().unwrap() = Some(done);
        unsafe {
            let types: *mut AnyObject = msg_send![class!(NSArray), arrayWithObject: ns_string("public.text")];
            let picker: *mut AnyObject = msg_send![class!(UIDocumentPickerViewController), alloc];
            // the import mode (a copy in the app's sandbox): UIDocumentPickerModeImport = 0
            let picker: *mut AnyObject = msg_send![picker, initWithDocumentTypes: types, inMode: 0usize];
            let delegate: Retained<PickerDelegate> = msg_send![PickerDelegate::class(), new];
            let _: () = msg_send![picker, setDelegate: &*delegate];
            // the picker holds its delegate weakly: keep ours for the app's life
            std::mem::forget(delegate);
            anchor(picker, over);
            let null: *mut AnyObject = std::ptr::null_mut();
            let _: () = msg_send![over, presentViewController: picker, animated: Bool::YES, completion: null];
        }
    }
}

/// Where a save goes: a system dialog on desktop, `downloads` on mobile.
pub fn save_dialog(name: &str, downloads: &std::path::Path) -> Option<PathBuf> { imp::save_dialog(name, downloads) }

/// A file the user picks (None: cancelled, or no picker on this platform).
pub fn open_dialog() -> Option<PathBuf> { imp::open_dialog() }

/// Android: the window's insets in physical px (left, top, right, bottom) —
/// system bars, display cutout and the soft keyboard — and how far the
/// keyboard reaches above the system bars. Apps targeting API 35+ are always
/// edge to edge, so the content rect alone does not show them.
#[cfg(target_os = "android")]
pub fn android_insets(vm: *mut std::ffi::c_void, activity: *mut std::ffi::c_void) -> Option<[i32; 5]> {
    use jni::objects::{JObject, JValue};
    let vm = unsafe { jni::JavaVM::from_raw(vm.cast()) }.ok()?;
    let mut env = vm.attach_current_thread_permanently().ok()?;
    let r = env.with_local_frame(16, |env| -> jni::errors::Result<Option<[i32; 5]>> {
        let act = unsafe { JObject::from_raw(activity as jni::sys::jobject) };
        let window = env.call_method(&act, "getWindow", "()Landroid/view/Window;", &[])?.l()?;
        let decor = env.call_method(&window, "getDecorView", "()Landroid/view/View;", &[])?.l()?;
        let wi = env.call_method(&decor, "getRootWindowInsets", "()Landroid/view/WindowInsets;", &[])?.l()?;
        if wi.is_null() {
            return Ok(None);
        }
        let mut types = [0; 3];
        for (i, name) in ["systemBars", "displayCutout", "ime"].iter().enumerate() {
            types[i] = env.call_static_method("android/view/WindowInsets$Type", name, "()I", &[])?.i()?;
        }
        let mut bottom_of = |env: &mut jni::JNIEnv, mask: i32, out: Option<&mut [i32; 5]>| -> jni::errors::Result<i32> {
            let ins = env.call_method(&wi, "getInsets", "(I)Landroid/graphics/Insets;", &[JValue::Int(mask)])?.l()?;
            if let Some(out) = out {
                for (i, f) in ["left", "top", "right", "bottom"].iter().enumerate() {
                    out[i] = env.get_field(&ins, f, "I")?.i()?;
                }
            }
            env.get_field(&ins, "bottom", "I")?.i()
        };
        let mut out = [0; 5];
        bottom_of(env, types[0] | types[1] | types[2], Some(&mut out))?;
        let bars = bottom_of(env, types[0], None)?;
        let ime = bottom_of(env, types[2], None)?;
        out[4] = (ime - bars).max(0);
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

/// iOS: how far the on-screen keyboard reaches up from the bottom of the
/// screen, in points (0 when it is hidden). UIKit says so only through
/// notifications: `watch_ios_keyboard` subscribes once, on the main thread.
#[cfg(target_os = "ios")]
mod ios_keyboard {
    use objc2::encode::{Encode, Encoding};
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct Rect { x: f64, y: f64, w: f64, h: f64 }
    unsafe impl Encode for Rect {
        const ENCODING: Encoding = Encoding::Struct("CGRect", &[
            Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]),
            Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]),
        ]);
    }

    static HEIGHT: AtomicU64 = AtomicU64::new(0);
    static WATCHING: AtomicBool = AtomicBool::new(false);

    fn ns_string(s: &std::ffi::CStr) -> *mut AnyObject {
        unsafe { msg_send![class!(NSString), stringWithUTF8String: s.as_ptr()] }
    }

    pub fn watch() {
        if WATCHING.swap(true, Ordering::SeqCst) { return }
        let block = block2::RcBlock::new(|note: *mut AnyObject| unsafe {
            if note.is_null() { return }
            let info: *mut AnyObject = msg_send![note, userInfo];
            if info.is_null() { return }
            let value: *mut AnyObject = msg_send![info, objectForKey: ns_string(c"UIKeyboardFrameEndUserInfoKey")];
            if value.is_null() { return }
            let frame: Rect = msg_send![value, CGRectValue];
            let screen: *mut AnyObject = msg_send![class!(UIScreen), mainScreen];
            let bounds: Rect = msg_send![screen, bounds];
            let h = (bounds.h - frame.y).clamp(0.0, bounds.h);
            HEIGHT.store(h.to_bits(), Ordering::SeqCst);
        });
        unsafe {
            let center: *mut AnyObject = msg_send![class!(NSNotificationCenter), defaultCenter];
            let null: *mut AnyObject = std::ptr::null_mut();
            let observer: *mut AnyObject = msg_send![center,
                addObserverForName: ns_string(c"UIKeyboardWillChangeFrameNotification"),
                object: null, queue: null, usingBlock: &*block];
            let _: *mut AnyObject = msg_send![observer, retain];
        }
        std::mem::forget(block);
    }

    pub fn height() -> f64 { f64::from_bits(HEIGHT.load(Ordering::SeqCst)) }
}

#[cfg(target_os = "ios")]
pub fn watch_ios_keyboard() { ios_keyboard::watch() }

#[cfg(target_os = "ios")]
pub fn ios_keyboard_height() -> f64 { ios_keyboard::height() }

/// Android: the user's display preferences as event 11's `b` — 1 reduce
/// motion (animations off), 2 more contrast (API 34+), + 256 × the font scale
/// in %.
#[cfg(target_os = "android")]
pub fn android_prefs(vm: *mut std::ffi::c_void, activity: *mut std::ffi::c_void) -> i64 {
    use jni::objects::{JObject, JValue};
    let Ok(vm) = (unsafe { jni::JavaVM::from_raw(vm.cast()) }) else { return 0 };
    let Ok(mut env) = vm.attach_current_thread_permanently() else { return 0 };
    let r = env.with_local_frame(16, |env| -> jni::errors::Result<i64> {
        let act = unsafe { JObject::from_raw(activity as jni::sys::jobject) };
        let res = env.call_method(&act, "getResources", "()Landroid/content/res/Resources;", &[])?.l()?;
        let config = env.call_method(&res, "getConfiguration", "()Landroid/content/res/Configuration;", &[])?.l()?;
        let scale = env.get_field(&config, "fontScale", "F")?.f()?;
        let cr = env.call_method(&act, "getContentResolver", "()Landroid/content/ContentResolver;", &[])?.l()?;
        let key = env.new_string("animator_duration_scale")?;
        let anim = env.call_static_method("android/provider/Settings$Global", "getFloat",
            "(Landroid/content/ContentResolver;Ljava/lang/String;F)F",
            &[JValue::Object(&cr), JValue::Object(&key), JValue::Float(1.0)])?.f()?;
        let sdk = env.get_static_field("android/os/Build$VERSION", "SDK_INT", "I")?.i()?;
        let mut contrast = 0.0;
        if sdk >= 34 {
            let name = env.new_string("uimode")?;
            let ui = env.call_method(&act, "getSystemService", "(Ljava/lang/String;)Ljava/lang/Object;", &[JValue::Object(&name)])?.l()?;
            if !ui.is_null() {
                contrast = env.call_method(&ui, "getContrast", "()F", &[])?.f()?;
            }
        }
        Ok((anim == 0.0) as i64 | ((contrast > 0.0) as i64) << 1 | (((scale * 100.0).round() as i64) << 8))
    });
    r.unwrap_or_else(|_| { let _ = env.exception_clear(); 0 })
}

/// iOS: the user's display preferences as event 11's `b` — 1 Reduce Motion,
/// 2 Increase Contrast, + 256 × the Dynamic Type text size in % (Large = 100).
#[cfg(target_os = "ios")]
pub fn ios_prefs() -> i64 {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    extern "C" {
        fn UIAccessibilityIsReduceMotionEnabled() -> bool;
        fn UIAccessibilityDarkerSystemColorsEnabled() -> bool;
    }
    // UIKit's body text size for each category ("UICTContentSizeCategoryXL"
    // and so on) against Large's 17 pt.
    const SIZES: [(&str, i64); 12] = [
        ("XS", 82), ("S", 88), ("M", 94), ("L", 100), ("XL", 112), ("XXL", 124), ("XXXL", 135),
        ("AccessibilityM", 165), ("AccessibilityL", 194), ("AccessibilityXL", 235),
        ("AccessibilityXXL", 276), ("AccessibilityXXXL", 312),
    ];
    let pct = unsafe {
        let app: *mut AnyObject = msg_send![class!(UIApplication), sharedApplication];
        let c: *mut AnyObject = msg_send![app, preferredContentSizeCategory];
        let p: *const std::ffi::c_char = if c.is_null() { std::ptr::null() } else { msg_send![c, UTF8String] };
        if p.is_null() { None } else { Some(std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned()) }
    }
    .and_then(|c| SIZES.iter().find(|(n, _)| c.strip_prefix("UICTContentSizeCategory") == Some(*n)).map(|(_, v)| *v))
    .unwrap_or(100);
    let (motion, contrast) = unsafe { (UIAccessibilityIsReduceMotionEnabled(), UIAccessibilityDarkerSystemColorsEnabled()) };
    motion as i64 | (contrast as i64) << 1 | pct << 8
}

/// Desktop: the user's display preferences as event 11's `b` — 1 reduce
/// motion, 2 more contrast, + 256 × the text scale in % (0: 100).
/// macOS: Reduce Motion and Increase Contrast (it has no text size of its
/// own). Windows: Settings › Accessibility › Text size, animation effects
/// off, a contrast theme. Linux (GNOME settings): text-scaling-factor,
/// enable-animations off, the high-contrast setting.
#[cfg(target_os = "macos")]
pub fn desktop_prefs() -> i64 {
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send};
    unsafe {
        let ws: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        if ws.is_null() { return 0 }
        let motion: Bool = msg_send![ws, accessibilityDisplayShouldReduceMotion];
        let contrast: Bool = msg_send![ws, accessibilityDisplayShouldIncreaseContrast];
        motion.as_bool() as i64 | (contrast.as_bool() as i64) << 1
    }
}

#[cfg(windows)]
pub fn desktop_prefs() -> i64 {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    use windows_sys::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION, SPI_GETHIGHCONTRAST};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let mut scale: u32 = 100;
    let mut size = 4u32;
    let (key, name) = (wide("Software\\Microsoft\\Accessibility"), wide("TextScaleFactor"));
    let ok = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), RRF_RT_REG_DWORD, std::ptr::null_mut(),
            (&mut scale as *mut u32).cast(), &mut size)
    };
    if ok != 0 { scale = 100 }
    let mut anim: i32 = 1;
    unsafe { SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, (&mut anim as *mut i32).cast(), 0) };
    let mut hc: HIGHCONTRASTW = unsafe { std::mem::zeroed() };
    hc.cbSize = std::mem::size_of::<HIGHCONTRASTW>() as u32;
    let got = unsafe { SystemParametersInfoW(SPI_GETHIGHCONTRAST, hc.cbSize, (&mut hc as *mut HIGHCONTRASTW).cast(), 0) };
    let contrast = got != 0 && hc.dwFlags & HCF_HIGHCONTRASTON != 0;
    (anim == 0) as i64 | (contrast as i64) << 1 | (scale as i64) << 8
}

#[cfg(all(unix, not(any(target_os = "macos", target_os = "ios", target_os = "android"))))]
pub fn desktop_prefs() -> i64 {
    let get = |schema: &str, key: &str| -> Option<String> {
        let out = std::process::Command::new("gsettings").args(["get", schema, key]).output().ok()?;
        if !out.status.success() { return None }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    };
    let scale = get("org.gnome.desktop.interface", "text-scaling-factor")
        .and_then(|s| s.parse::<f64>().ok()).map(|f| (f * 100.0).round() as i64).unwrap_or(100);
    let motion = get("org.gnome.desktop.interface", "enable-animations").as_deref() == Some("false");
    let contrast = get("org.gnome.desktop.a11y.interface", "high-contrast").as_deref() == Some("true");
    motion as i64 | (contrast as i64) << 1 | scale << 8
}
