# ADR 0015 — Web builds shrunk with a pinned wasm-opt

## Context
Almide's verified renderer writes the wasm module as it is, with no
optimizer. Every visitor downloads that module before the first frame,
and the size budgets in `tests/perf/budgets.json` were measured on it.
After ADR 0014 the gallery was at 224.9 of its 225 KB, so any new feature
had to be paid for by shaving the code elsewhere. Rewriting closures as
loops saved only about 0.1 KB each. Almide's wasm has no name section, so
the code can't be profiled function by function.

`wasm-opt -Oz` (Binaryen) on the same modules:

| App | Almide's output | wasm-opt -Oz | Change |
|---|---|---|---|
| gallery | 230,333 B | 166,818 B | −27.6% |
| todo | 208,149 B | 148,583 B | −28.6% |
| hello | 206,439 B | 145,809 B | −29.4% |

Almide's own `--wasm-opt` flag says its output is "NOT the renderer's own
bytes": the optimized module is outside what Almide verifies.

## Decision
- **`tools/build_web.sh` runs wasm-opt `-Oz` on the app's module** after
  Almide builds it and after `tests/wasm_stubs.mjs` has checked Almide's
  own bytes. The stub check runs first because inlining can make a real
  function look like an exit stub.
- **`tools/wasm-opt` pins Binaryen version_133**, as `tools/almide` pins
  Almide. It downloads the release for the host into `.tools/`, checks
  the SHA-256 written in the script, and runs it. CI and local builds use
  the same binary, with no system install.
- **`-Oz --converge`**: the passes repeat until the module stops
  shrinking (about 0.8 KB more on the gallery; added with ADR 0017's text
  wrapping).
- **The features are listed explicitly**: bulk memory (and its opt
  variant), sign extension, mutable globals, non-trapping float-to-int,
  multi-value, tail calls. These are what Almide's wasm uses.
  `--all-features` must not be used: it writes an import encoding that V8
  rejects ("unknown import kind 0x7f").
- **`ceangal dev` skips the step** (`CEANGAL_WASM_OPT=0`) so reloads stay
  quick. `ceangal build web`, `ceangal test web`, the Pages deploy and CI
  all test and ship the optimized module.
- **Budgets are measured on the optimized module** and lowered:

  | App | Before | After | Measured now |
  |---|---|---|---|
  | gallery | 225 KB | 170 KB | 162.9 KB |
  | todo | 204 KB | 152 KB | 145.1 KB |
  | hello | 202 KB | 150 KB | 142.4 KB |

## Consequences
- Visitors download about 28% less wasm, and the budgets have about 7 KB
  of optimized headroom again.
- The shipped bytes are not the ones Almide verified. They are checked by
  running them: `ceangal test web`, the gallery's Chrome E2E, the
  playground's web E2E, `pages-e2e` against the deployed site, and the
  startup budget all use the optimized module. A wasm-opt bug would show
  up as a failing test, not as a silent difference.
- The pixel harness (`tests/pixel/run.mjs`) and its editor benchmark still
  build Almide's own module, so web/native parity is compared on the
  verified bytes.
- The first web build on a machine downloads Binaryen once (25 MB unpacked
  on macOS) into `.tools/`.
