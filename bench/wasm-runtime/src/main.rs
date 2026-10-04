// Pulley (wasmtime's portable interpreter) vs wasmi vs cranelift (JIT, for
// reference): instantiate + run each program to completion, stdout counted.
use std::time::Instant;

fn stdout_len(mem: &[u8], iovs: u32, n: u32) -> u32 {
    let mut total = 0;
    for i in 0..n {
        let b = (iovs + i * 8) as usize;
        total += u32::from_le_bytes(mem[b + 4..b + 8].try_into().unwrap());
    }
    total
}

fn run_wasmtime(bytes: &[u8], pulley: bool) -> anyhow::Result<(f64, f64, u64)> {
    run_wasmtime_inner(bytes, pulley).map_err(|e| anyhow::anyhow!("{e:?}"))
}

fn run_wasmtime_inner(bytes: &[u8], pulley: bool) -> wasmtime::Result<(f64, f64, u64)> {
    let mut cfg = wasmtime::Config::new();
    if pulley { cfg.target("pulley64")?; }
    cfg.consume_fuel(true);
    let engine = wasmtime::Engine::new(&cfg)?;
    let t0 = Instant::now();
    let module = wasmtime::Module::new(&engine, bytes)?;
    let compile = t0.elapsed().as_secs_f64() * 1000.0;
    let mut store = wasmtime::Store::new(&engine, 0u64);
    store.set_fuel(u64::MAX / 2)?;
    let mut linker = wasmtime::Linker::new(&engine);
    linker.func_wrap("wasi_snapshot_preview1", "fd_write", |mut c: wasmtime::Caller<'_, u64>, _fd: i32, iovs: i32, n: i32, nw: i32| -> i32 {
        let mem = c.get_export("memory").unwrap().into_memory().unwrap();
        let len = stdout_len(mem.data(&c), iovs as u32, n as u32);
        mem.data_mut(&mut c)[nw as usize..nw as usize + 4].copy_from_slice(&len.to_le_bytes());
        *c.data_mut() += len as u64;
        0
    })?;
    linker.func_wrap("wasi_snapshot_preview1", "random_get", |_c: wasmtime::Caller<'_, u64>, _p: i32, _n: i32| -> i32 { 0 })?;
    linker.func_wrap("wasi_snapshot_preview1", "proc_exit", |_c: wasmtime::Caller<'_, u64>, code: i32| -> wasmtime::Result<()> { Err(wasmtime::Error::msg(format!("exit {code}"))) })?;
    let t1 = Instant::now();
    let inst = linker.instantiate(&mut store, &module)?;
    let start = inst.get_typed_func::<(), ()>(&mut store, "_start")?;
    let r = start.call(&mut store, ());
    if let Err(e) = r { if !format!("{e:?}").contains("exit 0") { return Err(e); } }
    Ok((compile, t1.elapsed().as_secs_f64() * 1000.0, *store.data()))
}

fn run_wasmi(bytes: &[u8]) -> anyhow::Result<(f64, f64, u64)> {
    let mut cfg = wasmi::Config::default();
    cfg.consume_fuel(true);
    let engine = wasmi::Engine::new(&cfg);
    let t0 = Instant::now();
    let module = wasmi::Module::new(&engine, bytes)?;
    let compile = t0.elapsed().as_secs_f64() * 1000.0;
    let mut store = wasmi::Store::new(&engine, 0u64);
    store.set_fuel(u64::MAX / 2)?;
    let mut linker = wasmi::Linker::<u64>::new(&engine);
    linker.func_wrap("wasi_snapshot_preview1", "fd_write", |mut c: wasmi::Caller<'_, u64>, _fd: i32, iovs: i32, n: i32, nw: i32| -> i32 {
        let mem = c.get_export("memory").unwrap().into_memory().unwrap();
        let len = stdout_len(mem.data(&c), iovs as u32, n as u32);
        mem.data_mut(&mut c)[nw as usize..nw as usize + 4].copy_from_slice(&len.to_le_bytes());
        *c.data_mut() += len as u64;
        0
    })?;
    linker.func_wrap("wasi_snapshot_preview1", "random_get", |_c: wasmi::Caller<'_, u64>, _p: i32, _n: i32| -> i32 { 0 })?;
    linker.func_wrap("wasi_snapshot_preview1", "proc_exit", |_c: wasmi::Caller<'_, u64>, code: i32| -> Result<(), wasmi::Error> { Err(wasmi::Error::new(format!("exit {code}"))) })?;
    let t1 = Instant::now();
    let inst = linker.instantiate_and_start(&mut store, &module)?;
    let start = inst.get_typed_func::<(), ()>(&store, "_start")?;
    let r = start.call(&mut store, ());
    if let Err(e) = r { if !format!("{e:?}").contains("exit 0") { return Err(e.into()); } }
    Ok((compile, t1.elapsed().as_secs_f64() * 1000.0, *store.data()))
}

fn main() {
    let dir = std::env::args().nth(1).unwrap();
    let mut names: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "wasm")).collect();
    names.sort();
    println!("{:<16} {:>22} {:>22} {:>22}", "program", "pulley (compile/run ms)", "wasmi (compile/run ms)", "cranelift (compile/run)");
    for p in names {
        let bytes = std::fs::read(&p).unwrap();
        let best = |f: &dyn Fn() -> anyhow::Result<(f64, f64, u64)>| -> String {
            let mut b = (f64::MAX, f64::MAX, 0);
            for _ in 0..3 {
                match f() { Ok(r) => { if r.1 < b.1 { b = r; } } Err(e) => return format!("ERR {e}") }
            }
            format!("{:>8.1} / {:>8.1} ({}B)", b.0, b.1, b.2)
        };
        println!("{:<16} {:>22} {:>22} {:>22}", p.file_stem().unwrap().to_string_lossy(),
            best(&|| run_wasmtime(&bytes, true)), best(&|| run_wasmi(&bytes)), best(&|| run_wasmtime(&bytes, false)));
    }
}
