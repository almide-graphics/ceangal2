# ADR 0003 — wasmi runs user programs on native platforms

Date: 2026-10-04 · Status: accepted

## Context
Natively, the playground compiles user code to wasm with the linked compiler
crate and must run it in-process. iOS forbids JIT (no writable+executable
memory outside Apple's own engines), so the runtime has to be an interpreter
there: wasmtime's portable Pulley bytecode, or wasmi. One runtime on every
platform keeps the WASI shim, the ABI shim for user GUI programs and the
Stop / fuel logic single-sourced. Stop and the per-event budget of user GUI
programs need fuel (or epochs).

## Measurements
`bench/wasm-runtime/run.sh` (Apple M4 Pro, release, best of 3, ms;
wasmtime 49.0.2 with `target("pulley64")`, wasmi 2.0.0, Cranelift JIT for
reference; fuel metering on in all three):

| program       | Pulley compile / run | wasmi compile / run | Cranelift compile / run |
|---------------|---------------------:|--------------------:|------------------------:|
| heavy         |       9.9 / 302.7    |        0.1 /  92.1  |        8.8 /  13.1      |
| voronoi       |      13.0 / 1614.0   |        0.2 / 440.0  |       12.6 /  96.4      |
| fern          |       6.7 / 537.1    |        0.4 / 120.8  |        6.6 /  25.4      |
| mandelbrot    |       4.9 / 50.6     |        0.1 /  10.5  |        5.8 /   2.5      |
| mini-markdown |       8.0 / 0.1      |        0.1 /   0.2  |        7.9 /   0.0      |
| fizzbuzz      |       3.6 / 0.0      |        0.0 /   0.0  |        3.9 /   0.0      |

## Decision
wasmi on every native platform (macOS, Windows, Linux, iOS, Android).
- 3.3–4.6× faster than Pulley on every program, with essentially no compile
  step (lazy translation) — the playground's "Run" latency is the compile, so
  this matters as much as throughput.
- Pure Rust, small, builds for all targets including iOS / Android without a
  JIT or platform code; fuel metering is built in (Stop, per-event budgets).
- Cranelift is 5–7× faster still, but cannot ship on iOS and would make the
  runtime differ by platform; programs that need that speed are better served
  by `almide build` outside the playground.

## Consequences
- Console programs: wasmi on a worker thread, WASI preview 1 implemented by
  our shim (stdout/stderr streaming, data-file tabs, random, clock, exit).
  The program runs in fuel slices with `call_resumable`: each time a slice
  runs out (`ResumableCall::OutOfFuel`) the thread checks an atomic stop flag
  set by Stop, and either refuels and resumes or abandons the store.
- User GUI programs: wasmi on the UI thread with a fuel budget per event; the
  ABI is provided by a generated import shim over the Rust host modules.
- Revisit if wasmi's throughput becomes the bottleneck for GUI programs.
