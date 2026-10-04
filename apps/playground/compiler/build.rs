use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=Cargo.lock");

    // Get git commit hash of this playground repo
    let pg_commit = git_short_hash().unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=PLAYGROUND_COMMIT={}", pg_commit);

    // Get almide dependency version + commit from Cargo.lock
    let (almide_ver, almide_commit) = parse_lockfile();
    println!("cargo:rustc-env=ALMIDE_VERSION={}", almide_ver);
    println!("cargo:rustc-env=ALMIDE_COMMIT={}", almide_commit);

    embed_packages();
}

/// The packages user programs may import (`import ceangal`, `import
/// snaidhm.vector as vec`, …): this repository's own sources, embedded at the
/// commit the playground was built from. Dependencies first. Module names
/// follow the CLI resolver: `src/mod.almd` is the package name, `src/a/b.almd`
/// is `<pkg>.a.b`. Tests are left out.
const PACKAGES: &[&str] = &["snaidhm", "ceangal"];

fn embed_packages() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut out = String::from("pub static PACKAGES: &[(&str, &[(&str, &str)])] = &[\n");
    for pkg in PACKAGES {
        let src = root.join(pkg).join("src");
        println!("cargo:rerun-if-changed={}", src.display());
        let mut files = Vec::new();
        collect(&src, &src, &mut files);
        files.sort();
        out.push_str(&format!("    ({pkg:?}, &[\n"));
        for (rel, path) in files {
            let name = if rel == "mod" { pkg.to_string() } else { format!("{pkg}.{}", rel.replace('/', ".")) };
            println!("cargo:rerun-if-changed={}", path.display());
            // Provided modules carry no package id, so `import self.x` would
            // not resolve inside the package: spell it `import <pkg>.x`.
            let text = qualify_self_imports(&std::fs::read_to_string(&path).unwrap(), pkg);
            let dest = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join(format!("{name}.almd"));
            std::fs::write(&dest, text).unwrap();
            out.push_str(&format!("        ({name:?}, include_str!({:?})),\n", dest));
        }
        out.push_str("    ]),\n");
    }
    out.push_str("];\n");
    let dest = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("packages.rs");
    std::fs::write(dest, out).unwrap();
}

/// `import self.a.b [as x]` → `import pkg.a.b as x` (alias defaults to the
/// last segment); `import self as x` → `import pkg as x`.
fn qualify_self_imports(src: &str, pkg: &str) -> String {
    let mut out = String::with_capacity(src.len());
    for line in src.lines() {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("import self") {
            let (path, alias) = match rest.split_once(" as ") {
                Some((p, a)) => (p.trim(), Some(a.trim())),
                None => (rest.trim(), None),
            };
            let segs: Vec<&str> = path.trim_start_matches('.').split('.').filter(|s| !s.is_empty()).collect();
            let alias = alias.map(str::to_string).unwrap_or_else(|| segs.last().map_or(pkg.to_string(), |s| s.to_string()));
            let full = std::iter::once(pkg).chain(segs.iter().copied()).collect::<Vec<_>>().join(".");
            out.push_str(&format!("import {full} as {alias}"));
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn collect(base: &std::path::Path, dir: &std::path::Path, out: &mut Vec<(String, std::path::PathBuf)>) {
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            collect(base, &p, out);
        } else if p.extension().is_some_and(|x| x == "almd") && !p.file_stem().unwrap().to_string_lossy().ends_with("_test") {
            let rel = p.strip_prefix(base).unwrap().with_extension("");
            out.push((rel.to_string_lossy().replace('\\', "/"), p));
        }
    }
}

fn git_short_hash() -> Option<String> {
    let o = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()?;
    if o.status.success() {
        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        None
    }
}

fn parse_lockfile() -> (String, String) {
    let lock = match std::fs::read_to_string("Cargo.lock") {
        Ok(s) => s,
        Err(_) => return ("unknown".to_string(), "unknown".to_string()),
    };

    // Cargo.lock format:
    // [[package]]
    // name = "almide"
    // version = "0.1.0"
    // source = "git+https://...#87f3971c2d76..."
    let mut version = "unknown".to_string();
    let mut commit = "unknown".to_string();
    let mut found_almide = false;

    for line in lock.lines() {
        let trimmed = line.trim();
        if trimmed == "[[package]]" {
            found_almide = false;
        } else if trimmed == r#"name = "almide""# {
            found_almide = true;
        } else if found_almide {
            if let Some(ver) = trimmed.strip_prefix("version = \"") {
                version = ver.trim_end_matches('"').to_string();
            }
            if let Some(src) = trimmed.strip_prefix("source = \"") {
                // source = "git+https://...#commithash"
                if let Some(hash_pos) = src.find('#') {
                    let full = src[hash_pos + 1..].trim_end_matches('"');
                    commit = full[..7.min(full.len())].to_string();
                }
                break; // Got everything we need
            }
        }
    }
    (version, commit)
}
