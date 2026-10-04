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
    call(&ctx, EV_INIT, 0, 0, w, h, scale, 0.0);
    settle(&ctx, &mut t);
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
    clipboard: Option<arboard::Clipboard>,
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
        let scale = self.scale;
        let title = self.title.clone();
        if let Some(a) = self.a11y.as_mut() { a.update_if_active(|| crate::a11y::tree_update(scale, &title)); }
    }

    fn call(&self, kind: i64, a: i64, b: i64, x: f64, y: f64, z: f64, w: f64) -> i64 {
        call(&self.ctx, kind, a, b, x, y, z, w)
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
                let _ = cb.set_text(text);
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
        if self.window.is_some() {
            self.call(EV_LIFECYCLE, 1, 0, 0.0, 0.0, 0.0, 0.0);
            return;
        }
        let title = std::env::var("CEANGAL_TITLE").unwrap_or_else(|_| "ceangal".into());
        self.title = title.clone();
        // AccessKit must attach before the window is first shown.
        let attrs = Window::default_attributes()
            .with_title(title)
            .with_visible(false)
            .with_inner_size(winit::dpi::LogicalSize::new(1100.0, 760.0));
        let window = Arc::new(el.create_window(attrs).expect("create window"));
        self.a11y = Some(accesskit_winit::Adapter::with_event_loop_proxy(el, &window, self.proxy.clone()));
        window.set_visible(true);
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle_from_env());
        let surface = instance.create_surface(window.clone()).expect("create surface");
        gpu::init_shared(instance, Some(&surface));
        let size = window.inner_size();
        self.scale = window.scale_factor();
        self.ctx.borrow_mut().attach_surface(surface, size.width, size.height);
        self.window = Some(window.clone());
        let logical = size.to_logical::<f64>(self.scale);
        self.call(EV_INIT, 0, 0, logical.width, logical.height, self.scale, 0.0);
        self.apply_requests();
        window.request_redraw();
    }

    fn window_event(&mut self, el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        if let (Some(a), Some(w)) = (self.a11y.as_mut(), self.window.as_ref()) { a.process_event(w, &event); }
        match event {
            WindowEvent::CloseRequested => {
                self.call(EV_LIFECYCLE, 3, 0, 0.0, 0.0, 0.0, 0.0);
                el.exit();
                return;
            }
            WindowEvent::Resized(size) => {
                self.ctx.borrow_mut().resize_surface(size.width, size.height);
                let l = size.to_logical::<f64>(self.scale);
                self.call(EV_RESIZE, 0, 0, l.width, l.height, self.scale, 0.0);
            }
            WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
                self.scale = scale_factor;
                if let Some(w) = &self.window {
                    let size = w.inner_size();
                    self.ctx.borrow_mut().resize_surface(size.width, size.height);
                    let l = size.to_logical::<f64>(self.scale);
                    self.call(EV_RESIZE, 0, 0, l.width, l.height, self.scale, 0.0);
                }
            }
            WindowEvent::RedrawRequested => {
                let t = crate::sys::now_ms();
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
                let named = matches!(event.logical_key, Key::Named(_));
                let mut handled = false;
                if let Some(code) = key_code(&event.logical_key) {
                    if named || shortcut {
                        // Cmd/Ctrl+V: deliver the clipboard as a paste event.
                        if code == 22 && shortcut && phase != 1 {
                            if let Some(text) = self.clipboard.as_mut().and_then(|c| c.get_text().ok()) {
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
                let dark = matches!(theme, winit::window::Theme::Dark) as i64;
                self.call(EV_APPEARANCE, dark, 0, 0.0, 0.0, 0.0, 0.0);
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
    let event_loop = EventLoop::<UserEvent>::with_user_event().build().expect("event loop");
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
        clipboard: arboard::Clipboard::new().ok(),
    };
    event_loop.run_app(&mut app).expect("event loop");
}
