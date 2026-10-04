// Every function in abi/manifest.json (generated from tools/gen_bindings.py)
// must be implemented by every host: the JS host's import object and the
// Rust modules the @extern(rust) spellings resolve to.
//
//   node tests/abi_conformance.mjs

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "abi/manifest.json"), "utf8"));
const jsFile = { runner: "hosts/web/runner.js" };
const rustFile = { gpu: "snaidhm/native/gpu.rs", runner: "apps/playground/native/runner.rs" };
const rustType = { Int: "i64", Float: "f64", Unit: null };

let missing = 0;
for (const [ns, fns] of Object.entries(manifest)) {
  const rs = readFileSync(join(root, rustFile[ns] || `ceangal/native/${ns}.rs`), "utf8");
  const js = readFileSync(join(root, jsFile[ns] || "hosts/web/host.js"), "utf8");
  // The JS namespace object: `const <ns> = { ... };`
  const m = js.match(new RegExp(`const ${ns} = \\{([\\s\\S]*?)\\n    \\};`));
  const jsBody = m ? m[1] : (jsFile[ns] ? js : "");
  for (const f of fns) {
    if (!new RegExp(`\\b${f.name}\\s*:`).test(jsBody) && !(ns === "storage")) {
      console.log(`js   ${ns}.${f.name} missing`);
      missing++;
    }
    const sig = rs.match(new RegExp(`^pub fn ${f.name}\\(([^)]*)\\)\\s*(->\\s*(\\w+))?`, "m"));
    if (!sig) {
      console.log(`rust ${ns}.${f.name} missing`);
      missing++;
      continue;
    }
    const params = sig[1].split(",").map((p) => p.trim()).filter(Boolean).map((p) => p.split(":")[1].trim());
    const want = f.params.map((t) => rustType[t]);
    const ret = sig[3] || null;
    if (params.join(",") !== want.join(",") || (ret || null) !== rustType[f.ret]) {
      console.log(`rust ${ns}.${f.name} signature (${params}) -> ${ret} != (${want}) -> ${rustType[f.ret]}`);
      missing++;
    }
  }
}
// storage functions are built from a helper in host.js; check names exist.
const hostJs = readFileSync(join(root, "hosts/web/host.js"), "utf8");
for (const f of manifest.storage) {
  if (!hostJs.includes(`${f.name}:`)) { console.log(`js   storage.${f.name} missing`); missing++; }
}
const total = Object.values(manifest).reduce((n, f) => n + f.length, 0);
console.log(missing ? `${missing} conformance problem(s)` : `ok: ${total} ABI functions implemented by the JS and Rust hosts`);
process.exit(missing ? 1 : 0);
