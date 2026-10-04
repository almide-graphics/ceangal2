# 0001 — One host ABI, three implementations

## Context

ceangal v1 rendered with WebGPU from JS and put all text, selection and IME
in DOM elements, so it could only run in a browser. ceangal2 must run the
same program on six platforms and also run *user* GUI programs inside the
playground.

## Decision

* The guest talks to its host only through the namespaces in
  `docs/abi.md`, declared once in Almide with both `@extern(wasm, …)` and
  `@extern(rust, …)` spellings (generated from `tools/gen_bindings.py`).
* **Only `Int` and `Float` cross the boundary.** Bytes move as
  `(ptr, len)` from `bytes.data_ptr`; host→guest data is pulled into
  guest-allocated buffers. This keeps the JS host, the native host and the
  native wasm shim byte-for-byte the same contract, independent of the
  compiler's heap layout (verified on 0.66: a host write into a fresh
  `bytes.new(n)` is visible to the guest on both legs).
* The GPU namespace is a small WebGPU subset (pipelines with `layout: auto`,
  storage-buffer-pulled instances, one implicit encoder per frame), so the
  JS host is a thin mapping and the native host is wgpu.
* GPU state is per **context** (`GpuContext`), never process-global, so the
  playground and user programs cannot touch each other's objects and Stop
  is "drop the context".
* The guest exposes one entry point, `ceangal_event(kind, a, b, x, y, z, w)`.

## Consequences

* Each app root carries a one-line `@export` forwarding to
  `ceangal.dispatch` (wasm exports only root-module functions —
  almide/almide#3281).
* Library constants meant for apps are variants, not `let`s
  (almide/almide#3286).
* Pixel parity is testable: the M0 demo renders identically (max channel
  difference 0) through headless Chrome WebGPU and native wgpu/Metal.
