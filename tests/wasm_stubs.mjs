// Fails when a closure in a guest wasm calls a function whose entire body is
// `proc_exit(1); unreachable` — what the wasm leg emits in place of a closure
// body it could not lower (almide/almide#3296). (The runtime has a few such
// helpers of its own; closure trampolines never call them.) Such a build type-checks and
// links but dies on first use, so catch it before it ships.
//   node tests/wasm_stubs.mjs dist/web/playground.wasm [...]
import { readFileSync } from "node:fs";

function leb(b, i) { let r = 0, s = 0, x; do { x = b[i++]; r |= (x & 0x7f) << s; s += 7; } while (x & 0x80); return [r >>> 0, i]; }

function sleb(b, i) { let x; do { x = b[i++]; } while (x & 0x80); return i; }

// Direct `call` targets of one function body (enough of the instruction set
// for what the Almide wasm leg emits; stops at anything unknown).
function calls(b, start, end) {
  const out = [];
  let p = start, groups;
  [groups, p] = leb(b, p);
  for (let g = 0; g < groups; g++) { [, p] = leb(b, p); p++; }
  while (p < end) {
    const op = b[p++];
    if (op === 0x10) { let f; [f, p] = leb(b, p); out.push(f); }
    else if (op === 0x02 || op === 0x03 || op === 0x04) { if (b[p] === 0x40 || (b[p] >= 0x6f && b[p] <= 0x7f)) p++; else p = sleb(b, p); }
    else if (op === 0x0c || op === 0x0d || (op >= 0x20 && op <= 0x24) || op === 0xd2 || op === 0x3f || op === 0x40) { [, p] = leb(b, p); }
    else if (op === 0x0e) { let n; [n, p] = leb(b, p); for (let k = 0; k <= n; k++) [, p] = leb(b, p); }
    else if (op === 0x11) { [, p] = leb(b, p); [, p] = leb(b, p); }
    else if (op >= 0x28 && op <= 0x3e) { [, p] = leb(b, p); [, p] = leb(b, p); }
    else if (op === 0x41 || op === 0x42) p = sleb(b, p);
    else if (op === 0x43) p += 4;
    else if (op === 0x44) p += 8;
    else if (op === 0x1c) { let n; [n, p] = leb(b, p); p += n; }
    else if (op === 0xd0) p++;
    else if (op === 0xfc) { let sub; [sub, p] = leb(b, p); if (sub === 8) { [, p] = leb(b, p); p++; } else if (sub === 9 || sub === 13 || sub === 15 || sub === 16 || sub === 17) [, p] = leb(b, p); else if (sub === 10 || sub === 12 || sub === 14) { [, p] = leb(b, p); [, p] = leb(b, p); } else if (sub === 11) p++; }
    else if (op <= 0x01 || op === 0x05 || op === 0x0b || op === 0x0f || op === 0x1a || op === 0x1b || op === 0xd1 || (op >= 0x45 && op <= 0xc4)) {}
    else break;
  }
  return out;
}

function stubs(buf) {
  const b = new Uint8Array(buf);
  let i = 8, imports = 0, procExit = -1;
  const found = [], table = new Set(), bodies = new Map();
  while (i < b.length) {
    const id = b[i++];
    let size; [size, i] = leb(b, i);
    const end = i + size;
    if (id === 2) { // imports: find proc_exit's function index
      let n, p = i; [n, p] = leb(b, p);
      for (let k = 0; k < n; k++) {
        let l; [l, p] = leb(b, p); const mod = new TextDecoder().decode(b.subarray(p, p + l)); p += l;
        [l, p] = leb(b, p); const name = new TextDecoder().decode(b.subarray(p, p + l)); p += l;
        const kind = b[p++];
        if (kind === 0) { if (mod === "wasi_snapshot_preview1" && name === "proc_exit") procExit = imports; imports++; [, p] = leb(b, p); }
        else if (kind === 1) { p += 1; const f = b[p++]; [, p] = leb(b, p); if (f & 1) [, p] = leb(b, p); }
        else if (kind === 2) { const f = b[p++]; [, p] = leb(b, p); if (f & 1) [, p] = leb(b, p); }
        else if (kind === 3) { p += 2; }
      }
    } else if (id === 9) { // elements: the closure table (active segments, flags 0 or 2)
      let n, p = i; [n, p] = leb(b, p);
      for (let k = 0; k < n; k++) {
        let flags; [flags, p] = leb(b, p);
        if (flags !== 0 && flags !== 2) break;
        if (flags === 2) [, p] = leb(b, p);   // table index
        while (b[p] !== 0x0b) p++;            // offset expression
        p++;
        if (flags === 2) p++;                 // elemkind funcref
        let m; [m, p] = leb(b, p);
        for (let j = 0; j < m; j++) { let f; [f, p] = leb(b, p); table.add(f); }
      }
    } else if (id === 10) { // code
      let n, p = i; [n, p] = leb(b, p);
      for (let k = 0; k < n; k++) {
        let sz; [sz, p] = leb(b, p);
        const bodyEnd = p + sz;
        bodies.set(imports + k, [p, bodyEnd]);
        let q = p, groups; [groups, q] = leb(b, q);
        for (let g = 0; g < groups; g++) { [, q] = leb(b, q); q++; }
        // i32.const 1 (0x41 0x01) · call proc_exit (0x10 idx) · unreachable (0x00) · end (0x0b)
        if (procExit >= 0 && b[q] === 0x41 && b[q + 1] === 0x01 && b[q + 2] === 0x10) {
          const [callee, r] = leb(b, q + 3);
          if (callee === procExit && b[r] === 0x00 && b[r + 1] === 0x0b && r + 2 === bodyEnd && groups === 0) found.push(imports + k);
        }
        p = bodyEnd;
      }
    }
    i = end;
  }
  // Decode each closure body and collect its direct calls.
  const stubSet = new Set(found), hit = new Set();
  for (const t of table) {
    const r = bodies.get(t);
    if (!r) continue;
    for (const callee of calls(b, r[0], r[1])) if (stubSet.has(callee)) hit.add(callee);
  }
  return [...hit];
}

let bad = 0;
for (const f of process.argv.slice(2)) {
  const s = stubs(readFileSync(f));
  if (s.length) { bad++; console.log(`FAIL ${f}: ${s.length} exit(1) stub function(s): ${s.join(", ")} (almide/almide#3296)`); }
  else console.log(`ok   ${f}: no stubbed functions`);
}
process.exit(bad ? 1 : 0);
