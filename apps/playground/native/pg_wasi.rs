//! WASI preview 1 for programs the native playground runs (wasmi): stdout /
//! stderr to a sink, stdin from the `stdin.txt` tab, the other non-.almd
//! tabs as an in-memory directory `.` (read, write, create), random, clock,
//! exit. Anything else answers ENOSYS. The web runner gets the same surface
//! from browser_wasi_shim (hosts/web/runner-worker.js).

#![allow(dead_code)]

use std::collections::HashMap;
use wasmi::{Caller, Error, Linker, Module, Val, ExternType};

const ESUCCESS: i32 = 0;
const EBADF: i32 = 8;
const EINVAL: i32 = 28;
const ENOENT: i32 = 44;
const ENOSYS: i32 = 52;

pub struct OpenFile { name: String, pos: usize, write: bool }

pub struct WasiCtx {
    pub files: HashMap<String, Vec<u8>>,
    pub stdin: Vec<u8>,
    stdin_pos: usize,
    fds: HashMap<i32, OpenFile>,
    next_fd: i32,
    rng: u64,
    /// fd 1 / 2 output.
    pub sink: Box<dyn FnMut(i32, &[u8]) + Send>,
}

impl WasiCtx {
    pub fn new(files: HashMap<String, Vec<u8>>, stdin: Vec<u8>, sink: Box<dyn FnMut(i32, &[u8]) + Send>) -> Self {
        let seed = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(1, |d| d.as_nanos() as u64) | 1;
        WasiCtx { files, stdin, stdin_pos: 0, fds: HashMap::new(), next_fd: 4, rng: seed, sink }
    }
    fn random(&mut self) -> u8 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        (self.rng >> 24) as u8
    }
}

pub trait WasiHost { fn wasi(&mut self) -> &mut WasiCtx; }

fn memory<T>(c: &Caller<'_, T>) -> wasmi::Memory {
    c.get_export("memory").and_then(|e| e.into_memory()).expect("guest exports memory")
}
fn rd_u32(m: &[u8], p: usize) -> u32 { u32::from_le_bytes(m[p..p + 4].try_into().unwrap()) }
fn wr_u32(m: &mut [u8], p: usize, v: u32) { m[p..p + 4].copy_from_slice(&v.to_le_bytes()) }
fn wr_u64(m: &mut [u8], p: usize, v: u64) { m[p..p + 8].copy_from_slice(&v.to_le_bytes()) }

/// (offset, len) of each iovec.
fn iovecs(m: &[u8], iovs: i32, n: i32) -> Vec<(usize, usize)> {
    (0..n as usize).map(|i| { let b = iovs as usize + i * 8; (rd_u32(m, b) as usize, rd_u32(m, b + 4) as usize) }).collect()
}

const DEFINED: &[&str] = &[
    "fd_write", "fd_read", "fd_close", "fd_prestat_get", "fd_prestat_dir_name", "fd_filestat_get", "path_open",
    "environ_sizes_get", "environ_get", "args_sizes_get", "args_get", "random_get", "clock_time_get", "proc_exit",
];

pub fn link<T: WasiHost + 'static>(linker: &mut Linker<T>, module: &Module) -> Result<(), Error> {
    const M: &str = "wasi_snapshot_preview1";
    linker.func_wrap(M, "fd_write", |mut c: Caller<'_, T>, fd: i32, iovs: i32, n: i32, nw: i32| -> i32 {
        let mem = memory(&c);
        let data: Vec<u8> = { let m = mem.data(&c); iovecs(m, iovs, n).into_iter().flat_map(|(p, l)| m[p..p + l].to_vec()).collect() };
        let w = c.data_mut().wasi();
        let r = if fd == 1 || fd == 2 { (w.sink)(fd, &data); ESUCCESS } else if let Some(f) = w.fds.get_mut(&fd) {
            if !f.write { EBADF } else {
                let file = w.files.entry(f.name.clone()).or_default();
                let end = f.pos + data.len();
                if file.len() < end { file.resize(end, 0); }
                file[f.pos..end].copy_from_slice(&data);
                f.pos = end;
                ESUCCESS
            }
        } else { EBADF };
        if r == ESUCCESS { wr_u32(mem.data_mut(&mut c), nw as usize, data.len() as u32); }
        r
    })?;
    linker.func_wrap(M, "fd_read", |mut c: Caller<'_, T>, fd: i32, iovs: i32, n: i32, nr: i32| -> i32 {
        let mem = memory(&c);
        let vecs = iovecs(mem.data(&c), iovs, n);
        let want: usize = vecs.iter().map(|v| v.1).sum();
        let w = c.data_mut().wasi();
        let chunk: Vec<u8> = if fd == 0 {
            let s = &w.stdin[w.stdin_pos.min(w.stdin.len())..];
            let k = s.len().min(want); let out = s[..k].to_vec(); w.stdin_pos += k; out
        } else if let Some(f) = w.fds.get_mut(&fd) {
            let file = w.files.get(&f.name).map(|v| v.as_slice()).unwrap_or(&[]);
            let s = &file[f.pos.min(file.len())..];
            let k = s.len().min(want); let out = s[..k].to_vec(); f.pos += k; out
        } else { return EBADF };
        let m = mem.data_mut(&mut c);
        let mut off = 0;
        for (p, l) in vecs { let k = l.min(chunk.len() - off); m[p..p + k].copy_from_slice(&chunk[off..off + k]); off += k; if off == chunk.len() { break; } }
        wr_u32(m, nr as usize, chunk.len() as u32);
        ESUCCESS
    })?;
    linker.func_wrap(M, "fd_close", |mut c: Caller<'_, T>, fd: i32| -> i32 {
        if c.data_mut().wasi().fds.remove(&fd).is_some() || fd <= 3 { ESUCCESS } else { EBADF }
    })?;
    linker.func_wrap(M, "fd_prestat_get", |mut c: Caller<'_, T>, fd: i32, buf: i32| -> i32 {
        if fd != 3 { return EBADF }
        let mem = memory(&c); let m = mem.data_mut(&mut c);
        m[buf as usize] = 0; wr_u32(m, buf as usize + 4, 1); ESUCCESS
    })?;
    linker.func_wrap(M, "fd_prestat_dir_name", |mut c: Caller<'_, T>, fd: i32, p: i32, len: i32| -> i32 {
        if fd != 3 || len < 1 { return EBADF }
        let mem = memory(&c); mem.data_mut(&mut c)[p as usize] = b'.'; ESUCCESS
    })?;
    linker.func_wrap(M, "fd_filestat_get", |mut c: Caller<'_, T>, fd: i32, buf: i32| -> i32 {
        let (kind, size) = {
            let w = c.data_mut().wasi();
            if fd <= 2 { (2u8, 0u64) } else if fd == 3 { (3, 0) } else if let Some(f) = w.fds.get(&fd) { (4, w.files.get(&f.name).map_or(0, |v| v.len() as u64)) } else { return EBADF }
        };
        let mem = memory(&c); let m = mem.data_mut(&mut c); let b = buf as usize;
        m[b..b + 64].fill(0); m[b + 16] = kind; wr_u64(m, b + 24, 1); wr_u64(m, b + 32, size);
        ESUCCESS
    })?;
    linker.func_wrap(M, "path_open", |mut c: Caller<'_, T>, dirfd: i32, _dirflags: i32, p: i32, len: i32, oflags: i32, rights: i64, _inh: i64, _fdflags: i32, out: i32| -> i32 {
        if dirfd != 3 { return EBADF }
        let mem = memory(&c);
        let raw = String::from_utf8_lossy(&mem.data(&c)[p as usize..(p + len) as usize]).into_owned();
        let name = raw.trim_start_matches("./").to_string();
        let w = c.data_mut().wasi();
        let create = oflags & 1 != 0;
        let trunc = oflags & 8 != 0;
        if !w.files.contains_key(&name) {
            if !create { return ENOENT }
            w.files.insert(name.clone(), Vec::new());
        } else if trunc { w.files.insert(name.clone(), Vec::new()); }
        let write = rights & (1 << 6) != 0 || create || trunc;
        let fd = w.next_fd; w.next_fd += 1;
        w.fds.insert(fd, OpenFile { name, pos: 0, write });
        wr_u32(mem.data_mut(&mut c), out as usize, fd as u32);
        ESUCCESS
    })?;
    linker.func_wrap(M, "environ_sizes_get", |mut c: Caller<'_, T>, cnt: i32, size: i32| -> i32 {
        let mem = memory(&c); let m = mem.data_mut(&mut c); wr_u32(m, cnt as usize, 0); wr_u32(m, size as usize, 0); ESUCCESS
    })?;
    linker.func_wrap(M, "environ_get", |_c: Caller<'_, T>, _a: i32, _b: i32| -> i32 { ESUCCESS })?;
    linker.func_wrap(M, "args_sizes_get", |mut c: Caller<'_, T>, cnt: i32, size: i32| -> i32 {
        let mem = memory(&c); let m = mem.data_mut(&mut c); wr_u32(m, cnt as usize, 0); wr_u32(m, size as usize, 0); ESUCCESS
    })?;
    linker.func_wrap(M, "args_get", |_c: Caller<'_, T>, _a: i32, _b: i32| -> i32 { ESUCCESS })?;
    linker.func_wrap(M, "random_get", |mut c: Caller<'_, T>, p: i32, len: i32| -> i32 {
        let bytes: Vec<u8> = { let w = c.data_mut().wasi(); (0..len).map(|_| w.random()).collect() };
        let mem = memory(&c); mem.data_mut(&mut c)[p as usize..(p + len) as usize].copy_from_slice(&bytes); ESUCCESS
    })?;
    linker.func_wrap(M, "clock_time_get", |mut c: Caller<'_, T>, id: i32, _prec: i64, out: i32| -> i32 {
        let ns = if id == 0 {
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos() as u64)
        } else { (crate::sys::now_ms() * 1e6) as u64 };
        let mem = memory(&c); wr_u64(mem.data_mut(&mut c), out as usize, ns); ESUCCESS
    })?;
    linker.func_wrap(M, "proc_exit", |_c: Caller<'_, T>, code: i32| -> Result<(), Error> { Err(Error::i32_exit(code)) })?;
    // Everything else the module imports from WASI: ENOSYS (or a trap if it
    // returns nothing to say so with).
    for imp in module.imports() {
        if imp.module() != M { continue }
        let ExternType::Func(ft) = imp.ty() else { continue };
        let name = imp.name().to_string();
        if DEFINED.contains(&name.as_str()) { continue }
        let ft2 = ft.clone();
        let what = name.clone();
        let _ = linker.func_new(M, &name, ft.clone(), move |_c, _args, results: &mut [Val]| {
            match (ft2.results().first(), results.first_mut()) {
                (Some(_), Some(r)) => { *r = Val::I32(ENOSYS); Ok(()) }
                _ => Err(Error::new(format!("WASI {what} is not supported here"))),
            }
        });
    }
    let _ = EINVAL;
    Ok(())
}
