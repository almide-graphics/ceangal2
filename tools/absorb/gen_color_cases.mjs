// Expected results for ceangal.color (ceangal/src/color_test.almd), recorded
// from tinycolor2 1.6.0 (MIT) used as an oracle only: its code is not part of
// this repository, and ceangal.color was written from the behaviour these
// cases record (docs/adr/0023-absorbing-libraries.md).
//
//   npm install --prefix <dir> tinycolor2@1.6.0
//   TINYCOLOR=<dir>/node_modules/tinycolor2 node tools/absorb/gen_color_cases.mjs
//
// Each line: an operation, its arguments and the expected result, separated
// by tabs. Colors are written back as tinycolor's toHex8String.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tinycolor = createRequire(import.meta.url)(process.env.TINYCOLOR || "tinycolor2");
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

// a small deterministic generator (mulberry32)
let seed = 23;
const rand = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (n) => Math.floor(rand() * n);
const pick = (xs) => xs[int(xs.length)];
const hex2 = (n) => n.toString(16).padStart(2, "0");

// inputs in the forms ceangal.color reads
function input() {
  switch (int(9)) {
    case 0: return "#" + hex2(int(256)) + hex2(int(256)) + hex2(int(256));
    case 1: return "#" + int(16).toString(16) + int(16).toString(16) + int(16).toString(16);
    case 2: return "#" + hex2(int(256)) + hex2(int(256)) + hex2(int(256)) + hex2(int(256));
    case 3: return hex2(int(256)) + hex2(int(256)) + hex2(int(256)).toUpperCase();
    case 4: return `rgb(${int(256)}, ${int(256)}, ${int(256)})`;
    case 5: return `rgba(${int(256)}, ${int(256)}, ${int(256)}, ${pick(["0", "0.5", "1", (int(100) / 100).toString()])})`;
    case 6: return `hsl(${int(360)}, ${int(101)}%, ${int(101)}%)`;
    case 7: return `hsla(${int(360)}, ${int(101)}%, ${int(101)}%, ${(int(100) / 100).toString()})`;
    default: return `rgb(${int(101)}%, ${int(101)}%, ${int(101)}%)`;
  }
}
const invalid = ["", "#12", "#12345", "rgb(1, 2)", "hsl(10, 20%)", "#ggg", "nonsense", "rgb(a, b, c)"];

const lines = [];
const add = (...cols) => lines.push(cols.join("\t"));
const out = (c) => c.toHex8String();
for (const s of invalid) add("valid", s, String(tinycolor(s).isValid()));
for (let i = 0; i < 400; i++) {
  const s = input();
  const c = tinycolor(s);
  add("hex8", s, c.isValid() ? out(c) : "invalid");
  add("rgb", s, c.toRgbString());
  add("hsl", s, c.toHslString());
  const amount = int(101);
  add("lighten", s, amount, out(tinycolor(s).lighten(amount)));
  add("darken", s, amount, out(tinycolor(s).darken(amount)));
  add("saturate", s, amount, out(tinycolor(s).saturate(amount)));
  add("desaturate", s, amount, out(tinycolor(s).desaturate(amount)));
  const deg = int(721) - 360;
  add("spin", s, deg, out(tinycolor(s).spin(deg)));
  const t = input();
  add("mix", s, t, amount, out(tinycolor.mix(s, t, amount)));
  add("luminance", s, tinycolor(s).getLuminance().toFixed(9));
  add("contrast", s, t, tinycolor.readability(s, t).toFixed(9));
  add("readable", s, t, String(tinycolor.isReadable(s, t)));
}
const dst = join(root, "tests/absorb/color.txt");
writeFileSync(dst, lines.join("\n") + "\n");
console.log(`tests/absorb/color.txt: ${lines.length} cases`);
