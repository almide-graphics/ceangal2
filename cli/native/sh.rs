//! Running tools the way a terminal user would: output streams as it comes,
//! and the exit code comes back (almide/almide#3379: the stdlib's
//! `process.exec*` capture the output, `process.spawn` cannot wait).

/// Run `cmd args…` in `dir` ("" = here) with the terminal's stdio and the
/// extra environment `keys[i] = vals[i]`; the exit code, or -1 when it could
/// not start (the reason goes to stderr).
pub fn sh_run(cmd: &str, args: &[String], dir: &str, keys: &[String], vals: &[String]) -> i64 {
    let mut c = std::process::Command::new(program(cmd));
    c.args(args);
    if !dir.is_empty() { c.current_dir(dir); }
    for (k, v) in keys.iter().zip(vals) { c.env(k, v); }
    match c.status() {
        Ok(s) => s.code().unwrap_or(-1) as i64,
        Err(e) => { eprintln!("ceangal: cannot run {cmd}: {e}"); -1 }
    }
}

/// Windows: `bash` is Git's (the tools are bash scripts); a bare `bash` would
/// find System32\bash.exe first, WSL's launcher. `$CEANGAL_BASH` overrides.
pub fn program(cmd: &str) -> String {
    if !cfg!(windows) || cmd != "bash" { return cmd.to_string() }
    if let Ok(b) = std::env::var("CEANGAL_BASH") { return b }
    for base in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(dir) = std::env::var(base) {
            for rel in [r"Git\bin\bash.exe", r"Programs\Git\bin\bash.exe"] {
                let p = std::path::Path::new(&dir).join(rel);
                if p.exists() { return p.to_string_lossy().into_owned() }
            }
        }
    }
    cmd.to_string()
}

/// The directory as an absolute, normalised path ("" when it does not exist).
/// On Windows without the `\\?\` prefix and with forward slashes: the form
/// Cargo, bash and PowerShell all take.
pub fn sh_real(path: &str) -> String {
    let p = match std::fs::canonicalize(path) { Ok(p) => p.to_string_lossy().into_owned(), Err(_) => return String::new() };
    if cfg!(windows) { p.trim_start_matches(r"\\?\").replace('\\', "/") } else { p }
}

/// "macos", "linux", "windows" or another `std::env::consts::OS`.
pub fn sh_os() -> String { std::env::consts::OS.to_string() }

// ceangal.toml as JSON for the stdlib's json/value modules (almide/toml does
// not build with Almide 0.66: almide/toml#2). A parse error comes back as
// {"__error": "..."}.
pub fn sh_toml_json(text: &str) -> String {
    match text.parse::<toml::Table>() {
        Ok(t) => serde_json::to_string(&t).unwrap_or_default(),
        Err(e) => serde_json::json!({ "__error": e.to_string() }).to_string(),
    }
}
