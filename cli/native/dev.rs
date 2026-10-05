//! `ceangal dev`: what the edit-build-reload loop needs that the stdlib does
//! not have — a stamp of the app's files to notice changes, a small static
//! server whose pages reload themselves after each build (and show the
//! build's error instead when it fails), an atomic swap of the served build,
//! child processes to restart, and a run that keeps its output.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

/// A fingerprint of every file under `paths` (names, sizes, mtimes);
/// build output and VCS folders are skipped.
pub fn dev_stamp(paths: &[String]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    fn walk(p: &Path, h: &mut std::collections::hash_map::DefaultHasher) {
        let Ok(meta) = std::fs::metadata(p) else { return };
        if meta.is_dir() {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if matches!(name, "build" | "target" | ".git" | "node_modules" | "out" | ".almide") { return }
            let Ok(rd) = std::fs::read_dir(p) else { return };
            let mut kids: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
            kids.sort();
            for k in kids { walk(&k, h) }
        } else {
            p.hash(h);
            meta.len().hash(h);
            if let Ok(t) = meta.modified() {
                if let Ok(d) = t.duration_since(std::time::UNIX_EPOCH) { d.as_nanos().hash(h) }
            }
        }
    }
    for p in paths { if !p.is_empty() { walk(Path::new(p), &mut h) } }
    format!("{:016x}", h.finish())
}

/// A line on stdout, flushed: Almide's println holds output until exit in
/// this program (almide/almide#3417), and dev runs until stopped.
pub fn dev_say(line: &str) {
    let mut o = std::io::stdout().lock();
    let _ = writeln!(o, "{line}");
    let _ = o.flush();
}

pub fn dev_sleep(ms: i64) { std::thread::sleep(std::time::Duration::from_millis(ms.max(0) as u64)) }

// ── the dev server ──

struct Served { root: String, version: u64, error: String }
static SERVED: Mutex<Option<Served>> = Mutex::new(None);

/// Polls /__ceangal/version: reloads on a new build, shows the error of a
/// failed one (and clears it when the next build succeeds).
const RELOAD: &str = r#"<script>(()=>{let v=null,box=null;const show=(t)=>{if(!box){box=document.createElement("pre");box.style.cssText="position:fixed;inset:0;margin:0;padding:24px;background:rgba(20,10,12,.94);color:#ffd7d7;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow:auto;z-index:2147483647";document.documentElement.appendChild(box)}box.textContent="ceangal dev: the build failed\n\n"+t};setInterval(async()=>{try{const t=await (await fetch("/__ceangal/version",{cache:"no-store"})).text();if(v===null){v=t;if(t.startsWith("e"))show(await (await fetch("/__ceangal/error",{cache:"no-store"})).text());return}if(t===v)return;v=t;if(t.startsWith("e"))show(await (await fetch("/__ceangal/error",{cache:"no-store"})).text());else location.reload()}catch(e){}},400)})()</script>"#;

fn content_type(p: &Path) -> &'static str {
    match p.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "wasm" => "application/wasm",
        "json" | "webmanifest" => "application/json",
        "css" => "text/css",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "ttf" => "font/ttf",
        "txt" | "md" | "almd" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn respond(mut s: std::net::TcpStream) {
    let mut line = String::new();
    if BufReader::new(&s).read_line(&mut line).is_err() { return }
    let path = line.split_whitespace().nth(1).unwrap_or("/").split(['?', '#']).next().unwrap_or("/").to_string();
    let (root, version, error) = {
        let g = SERVED.lock().unwrap();
        match g.as_ref() { Some(x) => (x.root.clone(), x.version, x.error.clone()), None => return }
    };
    let send = |s: &mut std::net::TcpStream, status: &str, ctype: &str, body: &[u8]| {
        let head = format!("HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nCross-Origin-Opener-Policy: same-origin\r\nCross-Origin-Embedder-Policy: require-corp\r\nConnection: close\r\n\r\n", body.len());
        let _ = s.write_all(head.as_bytes());
        let _ = s.write_all(body);
    };
    if path == "/__ceangal/version" {
        let v = if error.is_empty() { format!("{version}") } else { format!("e{version}") };
        return send(&mut s, "200 OK", "text/plain", v.as_bytes());
    }
    if path == "/__ceangal/error" { return send(&mut s, "200 OK", "text/plain; charset=utf-8", error.as_bytes()) }
    let rel = percent_decode(path.trim_start_matches('/'));
    if rel.split('/').any(|c| c == "..") { return send(&mut s, "403 Forbidden", "text/plain", b"forbidden") }
    let mut file = Path::new(&root).join(&rel);
    if file.is_dir() { file = file.join("index.html") }
    match std::fs::read(&file) {
        Ok(mut body) => {
            if file.extension().and_then(|e| e.to_str()) == Some("html") {
                let mut text = String::from_utf8_lossy(&body).into_owned();
                match text.rfind("</body>") { Some(i) => text.insert_str(i, RELOAD), None => text.push_str(RELOAD) }
                body = text.into_bytes();
            }
            send(&mut s, "200 OK", content_type(&file), &body)
        }
        // before the first build lands: a page that waits for it
        Err(_) if rel.is_empty() || rel == "index.html" => {
            let page = format!("<!doctype html><meta charset=utf-8><title>ceangal dev</title><body style=\"font:15px system-ui;padding:32px\">Building…{RELOAD}</body>");
            send(&mut s, "200 OK", "text/html; charset=utf-8", page.as_bytes())
        }
        Err(_) => send(&mut s, "404 Not Found", "text/plain", b"not found"),
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) { out.push(v); i += 3; continue }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Serve `root` on 127.0.0.1:`port` from a background thread; the port, or
/// -1 when it cannot listen.
pub fn dev_serve(root: &str, port: i64) -> i64 {
    let listener = match std::net::TcpListener::bind(("127.0.0.1", port as u16)) { Ok(l) => l, Err(e) => { eprintln!("ceangal: cannot listen on port {port}: {e}"); return -1 } };
    let actual = listener.local_addr().map(|a| a.port() as i64).unwrap_or(port);
    *SERVED.lock().unwrap() = Some(Served { root: root.to_string(), version: 0, error: String::new() });
    std::thread::spawn(move || {
        for s in listener.incoming().flatten() { std::thread::spawn(move || respond(s)); }
    });
    actual
}

/// A build finished: "" = it succeeded (pages reload), else its error.
pub fn dev_announce(error: &str) {
    if let Some(x) = SERVED.lock().unwrap().as_mut() { x.version += 1; x.error = error.to_string(); }
}

/// Put the build in `next` where `live` is (the server reads `live` per
/// request, so a page never sees half a build). 1 on success.
pub fn dev_publish(next: &str, live: &str) -> i64 {
    let old = format!("{live}.old");
    let _ = std::fs::remove_dir_all(&old);
    if Path::new(live).exists() && std::fs::rename(live, &old).is_err() { return 0 }
    if std::fs::rename(next, live).is_err() { return 0 }
    let _ = std::fs::remove_dir_all(&old);
    1
}

// ── processes ──

static LAST: Mutex<String> = Mutex::new(String::new());

/// Like sh_run, but the output also goes to a buffer (its last 32 KB, for
/// the error page): dev_last_output.
pub fn dev_run_tee(cmd: &str, args: &[String], dir: &str, keys: &[String], vals: &[String]) -> i64 {
    let mut c = Command::new(crate::sh::program(cmd));
    c.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if !dir.is_empty() { c.current_dir(dir); }
    for (k, v) in keys.iter().zip(vals) { c.env(k, v); }
    let mut child = match c.spawn() { Ok(ch) => ch, Err(e) => { *LAST.lock().unwrap() = format!("cannot run {cmd}: {e}"); return -1 } };
    let buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let pump = |src: Box<dyn Read + Send>, to_err: bool, buf: Arc<Mutex<Vec<u8>>>| std::thread::spawn(move || {
        let mut src = src;
        let mut chunk = [0u8; 4096];
        while let Ok(n) = src.read(&mut chunk) {
            if n == 0 { break }
            if to_err { let _ = std::io::stderr().write_all(&chunk[..n]); } else { let _ = std::io::stdout().write_all(&chunk[..n]); }
            let mut b = buf.lock().unwrap();
            b.extend_from_slice(&chunk[..n]);
            if b.len() > 64 * 1024 { let cut = b.len() - 32 * 1024; b.drain(..cut); }
        }
    });
    let t1 = pump(Box::new(child.stdout.take().unwrap()), false, buf.clone());
    let t2 = pump(Box::new(child.stderr.take().unwrap()), true, buf.clone());
    let code = child.wait().map(|s| s.code().unwrap_or(-1) as i64).unwrap_or(-1);
    let _ = (t1.join(), t2.join());
    let b = buf.lock().unwrap();
    let text = String::from_utf8_lossy(&b).into_owned();
    // ANSI colours make the error page unreadable
    *LAST.lock().unwrap() = strip_ansi(&text);
    code
}

pub fn dev_last_output() -> String { LAST.lock().unwrap().clone() }

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\u{1b}' && it.peek() == Some(&'[') {
            it.next();
            while let Some(&d) = it.peek() { it.next(); if d.is_ascii_alphabetic() { break } }
        } else { out.push(c) }
    }
    out
}

static CHILDREN: Mutex<Option<HashMap<i64, Child>>> = Mutex::new(None);

/// Start `cmd` (terminal stdio) without waiting: its id, or -1.
pub fn dev_spawn(cmd: &str, args: &[String], dir: &str, keys: &[String], vals: &[String]) -> i64 {
    let mut c = Command::new(crate::sh::program(cmd));
    c.args(args);
    if !dir.is_empty() { c.current_dir(dir); }
    for (k, v) in keys.iter().zip(vals) { c.env(k, v); }
    match c.spawn() {
        Ok(child) => {
            let id = child.id() as i64;
            CHILDREN.lock().unwrap().get_or_insert_with(HashMap::new).insert(id, child);
            id
        }
        Err(e) => { eprintln!("ceangal: cannot run {cmd}: {e}"); -1 }
    }
}

/// -1 while the spawned process runs, else its exit code (-2 when killed
/// by a signal or unknown).
pub fn dev_exit_code(id: i64) -> i64 {
    let mut g = CHILDREN.lock().unwrap();
    match g.get_or_insert_with(HashMap::new).get_mut(&id) {
        Some(c) => match c.try_wait() { Ok(None) => -1, Ok(Some(s)) => s.code().map(|c| c as i64).unwrap_or(-2), Err(_) => -2 },
        None => -2,
    }
}

pub fn dev_kill(id: i64) {
    if let Some(mut c) = CHILDREN.lock().unwrap().get_or_insert_with(HashMap::new).remove(&id) {
        let _ = c.kill();
        let _ = c.wait();
    }
}
