//! The native host loop: owns the window (winit) or an offscreen target
//! (headless), turns platform events into `ceangal.dispatch` calls
//! (docs/abi.md §2), and applies what the guest asked for in between
//! (frames, cursor, title, IME, clipboard).
//!
//! Headless mode — `CEANGAL_HEADLESS=<out.png>` — renders without a window
//! and writes the final frame as a PNG; `CEANGAL_SIZE=WxH`, `CEANGAL_SCALE`
//! and `CEANGAL_SCRIPT` ("click X Y; key 1 0; text abc; snap a.png") drive it.
//! This is what the pixel tests and the store screenshot generator use.

#![allow(dead_code)]

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use crate::gpu::{self, GpuContext};

/// The guest dispatcher (`ceangal.dispatch`), under its generated name.
fn dispatch(kind: i64, a: i64, b: i64, x: f64, y: f64, z: f64, w: f64) -> i64 {
    crate::almide_rt_ceangal_v0_dispatch(kind, a, b, x, y, z, w)
}

pub const EV_INIT: i64 = 1;
pub const EV_RESIZE: i64 = 2;
pub const EV_FRAME: i64 = 3;
pub const EV_POINTER: i64 = 4;
pub const EV_WHEEL: i64 = 5;
pub const EV_KEY: i64 = 6;
pub const EV_TEXT: i64 = 7;
pub const EV_FOCUS: i64 = 8;
pub const EV_LIFECYCLE: i64 = 9;
pub const EV_RESULT: i64 = 10;
pub const EV_APPEARANCE: i64 = 11;
pub const EV_A11Y: i64 = 12;

/// Wake-ups for the windowed loop: async results, or AccessKit.
pub enum UserEvent {
    Wake,
    A11y(accesskit_winit::Event),
}

impl From<accesskit_winit::Event> for UserEvent {
    fn from(e: accesskit_winit::Event) -> Self { UserEvent::A11y(e) }
}

// ── Android entry ──
//
// The app is a cdylib loaded by NativeActivity, which calls `android_main`
// on its own thread. almide renames the program's `main` in a cdylib; this
// runs it, and the program's `ceangal.run` enters the host loop below.

#[cfg(target_os = "android")]
pub use winit::platform::android::activity::AndroidApp;

#[cfg(target_os = "android")]
static ANDROID_APP: std::sync::OnceLock<AndroidApp> = std::sync::OnceLock::new();

#[cfg(target_os = "android")]
pub fn android_app() -> Option<&'static AndroidApp> { ANDROID_APP.get() }

/// `log` records (wgpu, winit) to logcat: warnings and errors.
#[cfg(target_os = "android")]
struct Logcat;

#[cfg(target_os = "android")]
impl log::Log for Logcat {
    fn enabled(&self, m: &log::Metadata) -> bool { m.level() <= log::Level::Warn }
    fn log(&self, r: &log::Record) {
        if self.enabled(r.metadata()) {
            crate::sys::log_line(&format!("{} {}: {}", r.level(), r.target(), r.args()));
        }
    }
    fn flush(&self) {}
}

/// stdout / stderr (println, runtime errors) go nowhere on Android: pipe them
/// into logcat line by line.
#[cfg(target_os = "android")]
fn redirect_stdio_to_logcat() {
    use std::io::BufRead;
    use std::os::fd::FromRawFd;
    extern "C" {
        fn pipe(fds: *mut i32) -> i32;
        fn dup2(old: i32, new: i32) -> i32;
    }
    let mut fds = [0i32; 2];
    if unsafe { pipe(fds.as_mut_ptr()) } != 0 { return }
    unsafe { dup2(fds[1], 1); dup2(fds[1], 2); }
    let read = unsafe { std::fs::File::from_raw_fd(fds[0]) };
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(read).lines().map_while(Result::ok) {
            crate::sys::log_line(&line);
        }
    });
}

#[cfg(target_os = "android")]
#[no_mangle]
fn android_main(app: AndroidApp) {
    std::panic::set_hook(Box::new(|info| crate::sys::log_line(&format!("panic: {info}"))));
    redirect_stdio_to_logcat();
    let _ = log::set_logger(&Logcat).map(|()| log::set_max_level(log::LevelFilter::Warn));
    let _ = ANDROID_APP.set(app);
    crate::__almide_unused_main();
}

pub fn run() {
    match std::env::var("CEANGAL_HEADLESS") {
        Ok(out) => run_headless(&out),
        Err(_) => run_windowed(),
    }
}

/// Call into the guest with `ctx` current.
fn call(ctx: &Rc<RefCell<GpuContext>>, kind: i64, a: i64, b: i64, x: f64, y: f64, z: f64, w: f64) -> i64 {
    gpu::enter(ctx, || dispatch(kind, a, b, x, y, z, w))
}

/// Hand every queued async result to the guest as event 10.
fn deliver_results(ctx: &Rc<RefCell<GpuContext>>) -> bool {
    let results = crate::sys::take_results();
    let any = !results.is_empty();
    for (id, status, body) in results {
        crate::sys::set_event_data(&body);
        call(ctx, EV_RESULT, id, status, 0.0, 0.0, 0.0, 0.0);
    }
    crate::sys::set_event_data(&[]);
    any
}

/// Headless: deliver results until no async work is in flight (or timeout).
fn wait_idle(ctx: &Rc<RefCell<GpuContext>>, t: &mut f64, timeout_s: f64) {
    let start = std::time::Instant::now();
    loop {
        deliver_results(ctx);
        settle(ctx, t);
        if crate::sys::in_flight() == 0 && !deliver_results(ctx) { break; }
        if start.elapsed().as_secs_f64() > timeout_s {
            eprintln!("ceangal: wait timed out with {} request(s) in flight", crate::sys::in_flight());
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
}

fn text_event(ctx: &Rc<RefCell<GpuContext>>, kind: i64, text: &str, cursor: i64) -> i64 {
    crate::sys::set_event_data(text.as_bytes());
    let r = call(ctx, EV_TEXT, kind, cursor, 0.0, 0.0, 0.0, 0.0);
    crate::sys::set_event_data(&[]);
    r
}

// ── Headless ─────────────────────────────────────────────────────────────

fn parse_size(s: &str) -> (f64, f64) {
    let mut it = s.split('x').map(|p| p.trim().parse::<f64>().unwrap_or(0.0));
    let w = it.next().unwrap_or(800.0);
    let h = it.next().unwrap_or(600.0);
    (if w > 0.0 { w } else { 800.0 }, if h > 0.0 { h } else { 600.0 })
}

fn settle(ctx: &Rc<RefCell<GpuContext>>, t: &mut f64) {
    // Headless time is virtual (frame times advance 16 ms): a timer fires at
    // once and the clock jumps to its due time, so debounces resolve without
    // waiting — the web host's settle() does the same.
    crate::sys::STATE.with(|s| {
        let now = crate::sys::now_ms();
        let mut s = s.borrow_mut();
        if let Some(due) = s.frame_deadline.take() {
            s.frame_requested = true;
            *t += (due - now).max(0.0);
        }
    });
    crate::file::perform(false);
    deliver_results(ctx);
    // Render until the guest stops asking for frames (bounded: animations).
    for _ in 0..8 {
        crate::sys::STATE.with(|s| {
            let now = crate::sys::now_ms();
            let mut s = s.borrow_mut();
            if let Some(due) = s.frame_deadline.take() {
                s.frame_requested = true;
                *t += (due - now).max(0.0);
            }
        });
        let wanted = crate::sys::take_frame_request();
        let again = call(ctx, EV_FRAME, 0, 0, *t, 0.0, 0.0, 0.0) == 1;
        *t += 16.0;
        if !wanted && !again {
            break;
        }
    }
    crate::a11y::dump_if_requested();
}

fn snapshot(ctx: &Rc<RefCell<GpuContext>>, path: &str) {
    let Some((w, h, rgba)) = ctx.borrow_mut().read_offscreen_rgba() else {
        eprintln!("ceangal: headless snapshot unavailable (no GPU)");
        std::process::exit(2);
    };
    let file = std::fs::File::create(path).unwrap_or_else(|e| panic!("ceangal: cannot write {path}: {e}"));
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut writer = enc.write_header().expect("png header");
    writer.write_image_data(&rgba).expect("png data");
    eprintln!("ceangal: wrote {path} ({w}x{h})");
}

fn run_headless(out: &str) {
    let (w, h) = parse_size(&std::env::var("CEANGAL_SIZE").unwrap_or_else(|_| "800x600".into()));
    let scale: f64 = std::env::var("CEANGAL_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1.0);
    let ctx = Rc::new(RefCell::new(GpuContext::new()));
    ctx.borrow_mut().set_offscreen((w * scale).ceil() as u32, (h * scale).ceil() as u32);
    let mut t = 0.0;
    let test = std::env::var("CEANGAL_TEST").ok();
    // a test finds views by their accessible labels: build the tree
    if test.is_some() { crate::a11y::ACTIVE.with(|a| a.set(true)); }
    call(&ctx, EV_INIT, 0, 0, w, h, scale, 0.0);
    settle(&ctx, &mut t);
    if let Some(file) = test {
        let code = run_test(&ctx, &mut t, &file, out);
        std::process::exit(code);
    }
    let script = std::env::var("CEANGAL_SCRIPT").unwrap_or_default();
    for cmd in script.split(';').map(str::trim).filter(|c| !c.is_empty()) {
        let parts: Vec<&str> = cmd.splitn(2, ' ').collect();
        let arg = parts.get(1).copied().unwrap_or("");
        let nums: Vec<f64> = arg.split_whitespace().filter_map(|n| n.parse().ok()).collect();
        let n = |i: usize| nums.get(i).copied().unwrap_or(0.0);
        match parts[0] {
            "click" => {
                call(&ctx, EV_POINTER, 1, 0, n(0), n(1), 0.0, 0.0);
                call(&ctx, EV_POINTER, 0, 0, n(0), n(1), 1.0, 0.0);
                call(&ctx, EV_POINTER, 2, 0, n(0), n(1), 0.0, 0.0);
            }
            "down" => { call(&ctx, EV_POINTER, 0, 0, n(0), n(1), 1.0, 0.0); }
            "move" => { call(&ctx, EV_POINTER, 1, 0, n(0), n(1), 1.0, 0.0); }
            "up" => { call(&ctx, EV_POINTER, 2, 0, n(0), n(1), 0.0, 0.0); }
            "wheel" => { call(&ctx, EV_WHEEL, 0, 1, n(0), n(1), n(2), n(3)); }
            "key" => { call(&ctx, EV_KEY, 0, n(0) as i64, n(1), 0.0, 0.0, 0.0); }
            "text" => { text_event(&ctx, 0, arg, 0); }
            "paste" => { text_event(&ctx, 3, arg, 0); }
            "preedit" => { text_event(&ctx, 1, arg, arg.len() as i64); }
            "preedit_end" => { text_event(&ctx, 2, "", 0); }
            "bench" => {
                // Scroll by `dy` and render, `n` times; report frame times.
                let count = (n(0) as usize).max(1);
                let dy = if nums.len() > 1 { n(1) } else { 37.0 };
                let mut times = Vec::with_capacity(count);
                for _ in 0..count {
                    let t0 = std::time::Instant::now();
                    call(&ctx, EV_WHEEL, 0, 1, w * 0.5, h * 0.5, 0.0, dy);
                    call(&ctx, EV_FRAME, 0, 0, t, 0.0, 0.0, 0.0);
                    if let Some(sh) = gpu::shared() { let _ = sh.device.poll(wgpu::PollType::Wait { submission_index: None, timeout: None }); }
                    times.push(t0.elapsed().as_secs_f64() * 1000.0);
                    t += 16.0;
                }
                times.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let avg = times.iter().sum::<f64>() / times.len() as f64;
                let p95 = times[(times.len() * 95 / 100).min(times.len() - 1)];
                println!("bench: frames={} avg_ms={:.3} p95_ms={:.3} max_ms={:.3}", times.len(), avg, p95, times[times.len() - 1]);
            }
            "frames" => {
                for _ in 0..(n(0) as i64).max(1) {
                    call(&ctx, EV_FRAME, 0, 0, t, 0.0, 0.0, 0.0);
                    t += 16.0;
                }
            }
            // Block until every request in flight has delivered its result.
            "wait" => wait_idle(&ctx, &mut t, if nums.is_empty() { 120.0 } else { n(0) }),
            "snap" => {
                settle(&ctx, &mut t);
                snapshot(&ctx, arg);
            }
            other => eprintln!("ceangal: unknown script command {other:?}"),
        }
        settle(&ctx, &mut t);
    }
    wait_idle(&ctx, &mut t, 120.0);
    snapshot(&ctx, out);
}

// ── `ceangal test` ───────────────────────────────────────────────────────
//
// An app test (tests/<name>.test) run headless: one step per line, views
// found by their accessible labels, as tests/e2e/app_test.mjs does on the
// web. Steps:
//   tap "Label"        press and release on the view with that label
//   type "text"        typed text, into the focused view
//   key Enter          a key, with modifiers as Shift+Tab, Ctrl+A, Cmd+Z
//   see "text"         some view's label or value contains the text
//   not "text"         no view's label or value contains it
//   wait 500           let 500 ms (of virtual time) pass
//   shot "name.png"    a screenshot, next to the output PNG
// Returns the exit code: 0 when every step passed.

fn test_arg(rest: &str) -> String {
    let r = rest.trim();
    if r.len() >= 2 && r.starts_with('"') && r.ends_with('"') {
        r[1..r.len() - 1].replace("\\\"", "\"").replace("\\n", "\n")
    } else {
        r.to_string()
    }
}

fn test_key(spec: &str) -> Option<(i64, f64)> {
    let mut mods = 0.0;
    let mut name = spec;
    for part in spec.split('+') {
        match part {
            "Shift" => mods += 1.0,
            "Ctrl" => mods += 2.0,
            "Alt" => mods += 4.0,
            "Cmd" | "Meta" => mods += 8.0,
            _ => name = part,
        }
    }
    let code = match name {
        "Enter" => 1, "Tab" => 2, "Backspace" => 3, "Delete" => 4, "Escape" => 5,
        "Left" => 10, "Right" => 11, "Up" => 12, "Down" => 13, "Home" => 14, "End" => 15,
        "PageUp" => 16, "PageDown" => 17, "Space" => 60,
        "A" => 20, "C" => 21, "V" => 22, "X" => 23, "Z" => 24, "Y" => 25, "S" => 26,
        _ => return None,
    };
    Some((code, mods))
}

fn test_tree() -> Vec<crate::a11y::Node> { crate::a11y::TREE.with(|t| t.borrow().committed.clone()) }

fn test_texts() -> Vec<String> {
    test_tree().iter().map(|n| match &n.value { Some(v) if !v.is_empty() => format!("{} = {v}", n.label), _ => n.label.clone() }).collect()
}

fn run_test(ctx: &Rc<RefCell<GpuContext>>, t: &mut f64, file: &str, out: &str) -> i32 {
    let src = match std::fs::read_to_string(file) {
        Ok(s) => s,
        Err(e) => { eprintln!("ceangal test: cannot read {file}: {e}"); return 2; }
    };
    let dir = std::path::Path::new(out).parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let mut steps = 0;
    for (i, raw) in src.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        let (cmd, rest) = line.split_once(' ').unwrap_or((line, ""));
        let arg = test_arg(rest);
        let fail = |msg: String| -> i32 {
            println!("FAIL {file}:{}: {line}\n     {msg}\n     on screen: {:?}", i + 1, test_texts());
            0
        };
        let ok = match cmd {
            "tap" => match test_tree().into_iter().find(|n| n.label == arg) {
                Some(n) => {
                    let (x, y) = (n.rect.0 + n.rect.2 / 2.0, n.rect.1 + n.rect.3 / 2.0);
                    call(ctx, EV_POINTER, 1, 0, x, y, 0.0, 0.0);
                    call(ctx, EV_POINTER, 0, 0, x, y, 1.0, 0.0);
                    call(ctx, EV_POINTER, 2, 0, x, y, 0.0, 0.0);
                    true
                }
                None => { fail(format!("no view labelled {arg:?}")); false }
            },
            "type" => { text_event(ctx, 0, &arg, 0); true }
            "key" => match test_key(&arg) {
                Some((code, mods)) => {
                    call(ctx, EV_KEY, 0, code, mods, 0.0, 0.0, 0.0);
                    call(ctx, EV_KEY, 1, code, mods, 0.0, 0.0, 0.0);
                    true
                }
                None => { fail(format!("unknown key {arg:?}")); false }
            },
            "see" | "not" => {
                wait_idle(ctx, t, 30.0);
                let found = test_texts().iter().any(|s| s.contains(&arg));
                if found == (cmd == "see") { true } else {
                    fail(if cmd == "see" { format!("{arg:?} is not on screen") } else { format!("{arg:?} is on screen") });
                    false
                }
            }
            "wait" => {
                let ms: f64 = arg.parse().unwrap_or(100.0);
                let end = *t + ms;
                while *t < end { call(ctx, EV_FRAME, 0, 0, *t, 0.0, 0.0, 0.0); *t += 16.0; }
                true
            }
            "shot" => { settle(ctx, t); snapshot(ctx, &dir.join(&arg).to_string_lossy()); true }
            _ => { fail(format!("unknown step {cmd:?} (tap, type, key, see, not, wait, shot)")); false }
        };
        if !ok {
            settle(ctx, t);
            snapshot(ctx, out);
            return 1;
        }
        settle(ctx, t);
        steps += 1;
    }
    settle(ctx, t);
    snapshot(ctx, out);
    println!("ok   {file}: {steps} steps");
    0
}

// ── Windowed ─────────────────────────────────────────────────────────────

use winit::application::ApplicationHandler;
use winit::event::{ElementState, Ime, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{Key, ModifiersState, NamedKey};
use winit::window::{CursorIcon, Window, WindowId};

struct Windowed {
    window: Option<Arc<Window>>,
    a11y: Option<accesskit_winit::Adapter>,
    proxy: winit::event_loop::EventLoopProxy<UserEvent>,
    title: String,
    ctx: Rc<RefCell<GpuContext>>,
    scale: f64,
    mods: ModifiersState,
    cursor: (f64, f64),
    buttons: i64,
    animating: bool,
    clipboard: Option<ceangal_platform::Clipboard>,
    /// Touch pointer ids: slot i holds the finger of pointer id i + 1.
    touches: Vec<Option<u64>>,
    dark: bool,
    insets: (f64, f64, f64, f64),
    /// Mobile: re-read the insets often until then (ms), while the keyboard
    /// animates, and now and then while it may be up (Android's Back and
    /// iOS's dismiss key close it without telling the app).
    kb_poll_until: f64,
    ime_on: bool,
}

/// The surface covers the whole window. On iOS `inner_size` is the safe
/// area, so the full size is `outer_size` there.
fn surface_size(w: &Window) -> winit::dpi::PhysicalSize<u32> {
    if cfg!(target_os = "ios") { w.outer_size() } else { w.inner_size() }
}

/// Safe-area insets in logical px (top, right, bottom, left): the parts of
/// the surface under the notch, system bars or home indicator.
fn safe_insets(w: &Window, scale: f64) -> (f64, f64, f64, f64) {
    let full = surface_size(w);
    let (fw, fh) = (full.width as f64, full.height as f64);
    #[cfg(target_os = "ios")]
    let (x, y, iw, ih) = {
        let o = w.outer_position().unwrap_or_default();
        let i = w.inner_position().unwrap_or_default();
        let s = w.inner_size();
        ((i.x - o.x) as f64, (i.y - o.y) as f64, s.width as f64, s.height as f64)
    };
    #[cfg(target_os = "android")]
    let (x, y, iw, ih) = match android_app().and_then(|a| ceangal_platform::android_insets(a.vm_as_ptr(), a.activity_as_ptr())) {
        Some([l, t, r, b]) => (l as f64, t as f64, fw - (l + r) as f64, fh - (t + b) as f64),
        None => (0.0, 0.0, fw, fh),
    };
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    let (x, y, iw, ih) = (0.0, 0.0, fw, fh);
    if iw <= 0.0 || ih <= 0.0 {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let c = |v: f64| (v / scale).max(0.0);
    let bottom = c(fh - y - ih);
    // iOS: the on-screen keyboard (points = logical px) covers the bottom
    #[cfg(target_os = "ios")]
    let bottom = bottom.max(ceangal_platform::ios_keyboard_height());
    (c(y), c(fw - x - iw), bottom, c(x))
}

fn mods_bits(m: ModifiersState) -> i64 {
    (m.shift_key() as i64) | ((m.control_key() as i64) << 1) | ((m.alt_key() as i64) << 2) | ((m.super_key() as i64) << 3)
}

/// docs/abi.md §2.2 key codes for keys that are not plain text.
fn key_code(key: &Key) -> Option<i64> {
    Some(match key {
        Key::Named(NamedKey::Enter) => 1,
        Key::Named(NamedKey::Tab) => 2,
        Key::Named(NamedKey::Backspace) => 3,
        Key::Named(NamedKey::Delete) => 4,
        Key::Named(NamedKey::Escape) => 5,
        Key::Named(NamedKey::ArrowLeft) => 10,
        Key::Named(NamedKey::ArrowRight) => 11,
        Key::Named(NamedKey::ArrowUp) => 12,
        Key::Named(NamedKey::ArrowDown) => 13,
        Key::Named(NamedKey::Home) => 14,
        Key::Named(NamedKey::End) => 15,
        Key::Named(NamedKey::PageUp) => 16,
        Key::Named(NamedKey::PageDown) => 17,
        Key::Named(NamedKey::Space) => 60,
        Key::Named(NamedKey::F1) => 40,
        Key::Named(NamedKey::F2) => 41,
        Key::Named(NamedKey::F3) => 42,
        Key::Named(NamedKey::F4) => 43,
        Key::Named(NamedKey::F5) => 44,
        Key::Named(NamedKey::F6) => 45,
        Key::Named(NamedKey::F7) => 46,
        Key::Named(NamedKey::F8) => 47,
        Key::Named(NamedKey::F9) => 48,
        Key::Named(NamedKey::F10) => 49,
        Key::Named(NamedKey::F11) => 50,
        Key::Named(NamedKey::F12) => 51,
        Key::Character(c) => match c.to_ascii_lowercase().as_str() {
            "a" => 20, "c" => 21, "v" => 22, "x" => 23, "z" => 24, "y" => 25,
            "s" => 26, "f" => 27, "o" => 28, "n" => 29, "w" => 30,
            _ => return None,
        },
        _ => return None,
    })
}

/// Android reports Enter / Tab / Backspace as their control characters.
fn normalize_key(key: &Key) -> Key {
    match key {
        Key::Character(c) if c == "\n" || c == "\r" => Key::Named(NamedKey::Enter),
        Key::Character(c) if c == "\t" => Key::Named(NamedKey::Tab),
        Key::Character(c) if c == "\u{8}" => Key::Named(NamedKey::Backspace),
        Key::Character(c) if c == "\u{7f}" => Key::Named(NamedKey::Delete),
        // The system back button / gesture closes things, like Escape.
        Key::Named(NamedKey::BrowserBack) => Key::Named(NamedKey::Escape),
        k => k.clone(),
    }
}

fn cursor_icon(kind: i64) -> CursorIcon {
    match kind {
        1 => CursorIcon::Text,
        2 => CursorIcon::Pointer,
        3 => CursorIcon::Grab,
        4 => CursorIcon::EwResize,
        5 => CursorIcon::NsResize,
        _ => CursorIcon::Default,
    }
}

impl Windowed {
    /// Give AccessKit the latest committed tree (when it is listening).
    fn push_a11y(&mut self, force: bool) {
        if !(crate::a11y::take_changed() || force) { return }
        crate::a11y::log_if_requested(self.scale);
        let scale = self.scale;
        let title = self.title.clone();
        if let Some(a) = self.a11y.as_mut() { a.update_if_active(|| crate::a11y::tree_update(scale, &title)); }
    }

    fn call(&self, kind: i64, a: i64, b: i64, x: f64, y: f64, z: f64, w: f64) -> i64 {
        call(&self.ctx, kind, a, b, x, y, z, w)
    }

    /// Event 11: theme and safe-area insets, when either changed (or `force`).
    fn send_appearance(&mut self, force: bool) {
        let Some(w) = self.window.clone() else { return };
        let insets = safe_insets(&w, self.scale);
        // Android: winit reports no theme; the configuration's night mode is it.
        #[cfg(target_os = "android")]
        let force = {
            use winit::platform::android::activity::ndk::configuration::UiModeNight;
            let dark = android_app().is_some_and(|a| a.config().ui_mode_night() == UiModeNight::Yes);
            let changed = dark != self.dark;
            self.dark = dark;
            force || changed
        };
        if insets != self.insets || force {
            self.insets = insets;
            let (t, r, b, l) = insets;
            self.call(EV_APPEARANCE, self.dark as i64, 0, t, r, b, l);
        }
    }

    /// Size the surface to the window and tell the guest.
    fn resize(&mut self) {
        let Some(w) = self.window.clone() else { return };
        let size = surface_size(&w);
        self.ctx.borrow_mut().resize_surface(size.width, size.height);
        let l = size.to_logical::<f64>(self.scale);
        self.call(EV_RESIZE, 0, 0, l.width, l.height, self.scale, 0.0);
        self.send_appearance(false);
    }

    /// A pointer id (>= 1) for a finger, allocated on touch start.
    fn touch_id(&mut self, finger: u64, start: bool) -> Option<i64> {
        if let Some(i) = self.touches.iter().position(|t| *t == Some(finger)) {
            return Some(i as i64 + 1);
        }
        if !start { return None }
        let i = match self.touches.iter().position(Option::is_none) {
            Some(i) => { self.touches[i] = Some(finger); i }
            None => { self.touches.push(Some(finger)); self.touches.len() - 1 }
        };
        Some(i as i64 + 1)
    }

    /// Apply what the guest requested during the last call(s).
    fn apply_requests(&mut self) {
        let Some(window) = self.window.clone() else { return };
        let (cursor, title) = crate::sys::STATE.with(|s| {
            let mut s = s.borrow_mut();
            (s.cursor.take(), s.title.take())
        });
        if let Some(c) = cursor {
            window.set_cursor(cursor_icon(c));
        }
        if let Some(t) = title {
            window.set_title(&t);
        }
        if let Some(req) = crate::text_input::take_change() {
            window.set_ime_allowed(req.active);
            self.kb_poll_until = crate::sys::now_ms() + 1000.0;
            self.ime_on = req.active;
            if req.active {
                let (x, y, w, h) = req.rect;
                window.set_ime_cursor_area(
                    winit::dpi::LogicalPosition::new(x, y),
                    winit::dpi::LogicalSize::new(w.max(1.0), h.max(1.0)),
                );
            }
        }
        crate::file::perform(true);
        if let Some(text) = crate::clipboard::take_write() {
            if let Some(cb) = self.clipboard.as_mut() {
                cb.set_text(text);
            }
        }
        if crate::sys::take_frame_request() || self.animating {
            window.request_redraw();
        }
    }
}

impl ApplicationHandler<UserEvent> for Windowed {
    /// Async results arrived (sys::post_result woke the loop), or AccessKit
    /// asked for the tree / an action.
    fn user_event(&mut self, _el: &ActiveEventLoop, ev: UserEvent) {
        match ev {
            UserEvent::Wake => { deliver_results(&self.ctx); }
            UserEvent::A11y(e) => match e.window_event {
                accesskit_winit::WindowEvent::InitialTreeRequested => {
                    crate::a11y::set_active(true);
                    // render once so ceangal builds the tree, then hand it over
                    self.call(EV_FRAME, 0, 0, crate::sys::now_ms(), 0.0, 0.0, 0.0);
                    self.push_a11y(true);
                }
                accesskit_winit::WindowEvent::ActionRequested(req) => {
                    if let Some(code) = crate::a11y::action_code(req.action) {
                        self.call(EV_A11Y, req.target_node.0 as i64, code, 0.0, 0.0, 0.0, 0.0);
                    }
                }
                accesskit_winit::WindowEvent::AccessibilityDeactivated => crate::a11y::set_active(false),
            },
        }
        self.apply_requests();
    }

    fn resumed(&mut self, el: &ActiveEventLoop) {
        let first = self.window.is_none();
        if first {
            let title = std::env::var("CEANGAL_TITLE").unwrap_or_else(|_| "ceangal".into());
            self.title = title.clone();
            // AccessKit must attach before the window is first shown.
            let mut attrs = Window::default_attributes().with_title(title).with_visible(false);
            if cfg!(not(any(target_os = "android", target_os = "ios"))) {
                attrs = attrs.with_inner_size(winit::dpi::LogicalSize::new(1100.0, 760.0));
            }
            let window = Arc::new(el.create_window(attrs).expect("create window"));
            #[cfg(target_os = "ios")]
            ceangal_platform::watch_ios_keyboard();
            self.a11y = Some(accesskit_winit::Adapter::with_event_loop_proxy(el, &window, self.proxy.clone()));
            window.set_visible(true);
            self.dark = matches!(window.theme(), Some(winit::window::Theme::Dark));
            self.window = Some(window);
        }
        let window = self.window.clone().unwrap();
        // Mobile drops the surface while suspended (the native window is
        // gone); make one for the current window.
        if !self.ctx.borrow().has_surface() {
            let existing = if gpu::shared_ready() { gpu::shared() } else { None };
            let surface = match existing {
                Some(sh) => sh.instance.create_surface(window.clone()).expect("create surface"),
                None => {
                    // Android: one backend per instance — a Vulkan and a GL
                    // surface cannot share the native window (EGL BadAlloc).
                    let order = if cfg!(target_os = "android") {
                        vec![wgpu::Backends::VULKAN, wgpu::Backends::GL]
                    } else {
                        vec![wgpu::Backends::all()]
                    };
                    let mut made = None;
                    for backends in order {
                        // GL (EGL) needs the display at instance creation.
                        let mut desc = wgpu::InstanceDescriptor::new_with_display_handle(Box::new(el.owned_display_handle()));
                        desc.backends = backends;
                        let desc = desc.with_env();
                        let instance = wgpu::Instance::new(desc);
                        let Ok(surface) = instance.create_surface(window.clone()) else { continue };
                        if gpu::try_init_shared(instance, &surface) {
                            made = Some(surface);
                            break;
                        }
                    }
                    match made {
                        Some(s) => s,
                        None => {
                            crate::sys::log_line("ceangal: no GPU adapter can present to this window");
                            return;
                        }
                    }
                }
            };
            if first && cfg!(any(target_os = "android", target_os = "ios")) {
                if let Some(sh) = gpu::shared() {
                    let i = sh.adapter.get_info();
                    crate::sys::log_line(&format!("ceangal: GPU {} ({:?})", i.name, i.backend));
                }
            }
            let size = surface_size(&window);
            self.scale = window.scale_factor();
            self.ctx.borrow_mut().attach_surface(surface, size.width, size.height);
        }
        if first {
            let l = surface_size(&window).to_logical::<f64>(self.scale);
            self.call(EV_INIT, 0, 0, l.width, l.height, self.scale, 0.0);
            self.send_appearance(true);
        } else {
            self.call(EV_LIFECYCLE, 1, 0, 0.0, 0.0, 0.0, 0.0);
            self.resize();
        }
        self.apply_requests();
        window.request_redraw();
    }

    fn suspended(&mut self, _el: &ActiveEventLoop) {
        self.call(EV_LIFECYCLE, 0, 0, 0.0, 0.0, 0.0, 0.0);
        if cfg!(any(target_os = "android", target_os = "ios")) {
            self.ctx.borrow_mut().detach_surface();
        }
    }

    fn memory_warning(&mut self, _el: &ActiveEventLoop) {
        self.call(EV_LIFECYCLE, 2, 0, 0.0, 0.0, 0.0, 0.0);
    }

    fn window_event(&mut self, el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        if let (Some(a), Some(w)) = (self.a11y.as_mut(), self.window.as_ref()) { a.process_event(w, &event); }
        match event {
            WindowEvent::CloseRequested => {
                self.call(EV_LIFECYCLE, 3, 0, 0.0, 0.0, 0.0, 0.0);
                el.exit();
                return;
            }
            WindowEvent::Resized(_) => self.resize(),
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                self.scale = scale_factor;
                self.resize();
            }
            WindowEvent::Touch(t) => {
                use winit::event::TouchPhase;
                let start = t.phase == TouchPhase::Started;
                if let Some(id) = self.touch_id(t.id, start) {
                    let l = t.location.to_logical::<f64>(self.scale);
                    let (phase, buttons) = match t.phase {
                        TouchPhase::Started => (0, 1.0),
                        TouchPhase::Moved => (1, 1.0),
                        TouchPhase::Ended => (2, 0.0),
                        TouchPhase::Cancelled => (3, 0.0),
                    };
                    if phase >= 2 {
                        self.touches[id as usize - 1] = None;
                    }
                    self.call(EV_POINTER, phase, id, l.x, l.y, buttons, 0.0);
                }
            }
            WindowEvent::RedrawRequested => {
                let t = crate::sys::now_ms();
                // The soft keyboard and system bars move without a resize.
                if cfg!(target_os = "android") { self.send_appearance(false); }
                self.animating = self.call(EV_FRAME, 0, 0, t, 0.0, 0.0, 0.0) == 1;
                self.push_a11y(false);
            }
            WindowEvent::ModifiersChanged(m) => self.mods = m.state(),
            WindowEvent::CursorMoved { position, .. } => {
                let l = position.to_logical::<f64>(self.scale);
                self.cursor = (l.x, l.y);
                self.call(EV_POINTER, 1, 0, l.x, l.y, self.buttons as f64, mods_bits(self.mods) as f64);
            }
            WindowEvent::CursorLeft { .. } => {
                self.call(EV_POINTER, 5, 0, self.cursor.0, self.cursor.1, 0.0, 0.0);
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let bit = match button { MouseButton::Left => 1, MouseButton::Right => 2, MouseButton::Middle => 4, _ => 0 };
                let phase = if state == ElementState::Pressed { self.buttons |= bit; 0 } else { self.buttons &= !bit; 2 };
                self.call(EV_POINTER, phase, 0, self.cursor.0, self.cursor.1, self.buttons as f64, mods_bits(self.mods) as f64);
            }
            WindowEvent::MouseWheel { delta, .. } => {
                let (unit, dx, dy) = match delta {
                    MouseScrollDelta::LineDelta(x, y) => (0, -x as f64, -y as f64),
                    MouseScrollDelta::PixelDelta(p) => {
                        let l = p.to_logical::<f64>(self.scale);
                        (1, -l.x, -l.y)
                    }
                };
                self.call(EV_WHEEL, mods_bits(self.mods), unit, self.cursor.0, self.cursor.1, dx, dy);
            }
            WindowEvent::KeyboardInput { event, is_synthetic: false, .. } => {
                let mods = mods_bits(self.mods);
                let shortcut = self.mods.control_key() || self.mods.super_key();
                let phase = match (event.state, event.repeat) {
                    (ElementState::Released, _) => 1,
                    (ElementState::Pressed, true) => 2,
                    _ => 0,
                };
                let key = normalize_key(&event.logical_key);
                let named = matches!(key, Key::Named(_));
                let mut handled = false;
                if let Some(code) = key_code(&key) {
                    if named || shortcut {
                        // Cmd/Ctrl+V: deliver the clipboard as a paste event.
                        if code == 22 && shortcut && phase != 1 {
                            if let Some(text) = self.clipboard.as_mut().and_then(|c| c.get_text()) {
                                text_event(&self.ctx, 3, &text, 0);
                                handled = true;
                            }
                        }
                        if !handled {
                            handled = self.call(EV_KEY, phase, code, mods as f64, 0.0, 0.0, 0.0) == 1;
                        }
                    }
                }
                if !handled && phase != 1 && !shortcut {
                    if let Some(text) = event.text.as_ref() {
                        let t = text.as_str();
                        if !t.is_empty() && !t.chars().all(|c| c.is_control()) {
                            text_event(&self.ctx, 0, t, 0);
                        }
                    }
                }
            }
            WindowEvent::Ime(ime) => match ime {
                Ime::Preedit(text, cursor) => {
                    if text.is_empty() {
                        text_event(&self.ctx, 2, "", 0);
                    } else {
                        text_event(&self.ctx, 1, &text, cursor.map_or(text.len(), |c| c.1) as i64);
                    }
                }
                Ime::Commit(text) => {
                    text_event(&self.ctx, 0, &text, 0);
                }
                _ => {}
            },
            WindowEvent::Focused(f) => {
                self.call(EV_FOCUS, f as i64, 0, 0.0, 0.0, 0.0, 0.0);
            }
            WindowEvent::ThemeChanged(theme) => {
                self.dark = matches!(theme, winit::window::Theme::Dark);
                self.send_appearance(true);
            }
            _ => {}
        }
        self.apply_requests();
        if let Some(code) = crate::sys::STATE.with(|s| s.borrow().exit_code) {
            std::process::exit(code as i32);
        }
    }

    fn about_to_wait(&mut self, el: &ActiveEventLoop) {
        // Smoke tests: CEANGAL_EXIT_AFTER_MS ends a windowed run cleanly.
        if let Some(ms) = std::env::var("CEANGAL_EXIT_AFTER_MS").ok().and_then(|v| v.parse::<f64>().ok()) {
            if crate::sys::now_ms() >= ms { el.exit(); return; }
            el.set_control_flow(ControlFlow::WaitUntil(std::time::Instant::now() + std::time::Duration::from_millis(50)));
            self.apply_requests();
            return;
        }
        let deadline = crate::sys::due_deadline();
        self.apply_requests();
        // Mobile: the keyboard moves in and out without a resize
        if cfg!(any(target_os = "ios", target_os = "android")) && (self.ime_on || crate::sys::now_ms() < self.kb_poll_until) {
            let before = self.insets;
            self.send_appearance(false);
            if self.insets != before {
                self.kb_poll_until = crate::sys::now_ms() + 1000.0;
                if let Some(w) = &self.window { w.request_redraw(); }
            }
            let fast = crate::sys::now_ms() < self.kb_poll_until;
            let step = std::time::Duration::from_millis(if fast { 30 } else { 250 });
            let wake = std::time::Instant::now() + step;
            let wake = match deadline {
                Some(at) => wake.min(std::time::Instant::now() + std::time::Duration::from_secs_f64(((at - crate::sys::now_ms()) / 1000.0).max(0.0))),
                None => wake,
            };
            el.set_control_flow(ControlFlow::WaitUntil(wake));
            return;
        }
        match deadline {
            Some(at) => {
                let wait = std::time::Duration::from_secs_f64(((at - crate::sys::now_ms()) / 1000.0).max(0.0));
                el.set_control_flow(ControlFlow::WaitUntil(std::time::Instant::now() + wait));
            }
            None => el.set_control_flow(ControlFlow::Wait),
        }
    }
}

fn run_windowed() {
    let mut builder = EventLoop::<UserEvent>::with_user_event();
    #[cfg(target_os = "android")]
    {
        use winit::platform::android::EventLoopBuilderExtAndroid;
        if let Some(app) = android_app() { builder.with_android_app(app.clone()); }
    }
    let event_loop = builder.build().expect("event loop");
    let proxy = event_loop.create_proxy();
    let waker = proxy.clone();
    crate::sys::set_waker(Box::new(move || { let _ = waker.send_event(UserEvent::Wake); }));
    let mut app = Windowed {
        window: None,
        a11y: None,
        proxy,
        title: String::new(),
        ctx: Rc::new(RefCell::new(GpuContext::new())),
        scale: 1.0,
        mods: ModifiersState::empty(),
        cursor: (0.0, 0.0),
        buttons: 0,
        animating: false,
        clipboard: ceangal_platform::Clipboard::new(),
        touches: Vec::new(),
        dark: false,
        insets: (0.0, 0.0, 0.0, 0.0),
        kb_poll_until: 0.0,
        ime_on: false,
    };
    event_loop.run_app(&mut app).expect("event loop");
}
