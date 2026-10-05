// The old playground's fixtures and every console example, with what the
// Almide CLI prints for each: what every platform's E2E checks a run against.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

// The edit every platform's E2E makes to the Todo example before running
// it: typed at the start of its first task's line (six lines down). The
// example keeps its four imports and a blank line above the task list: on
// phones long lines wrap and the arrow keys move by row, so the lines the
// cursor passes must be short.
export const EDIT_TODO = '{ id: next_id + next_id, title: "Edited", done: false }, ';

// The same edit on a phone: [how, text] with how "bar" (the key bar's
// "Insert <text>" button) or "keys" (the on-screen keyboard).
export const EDIT_TODO_KEYS = [
  ["bar", "{"], ["keys", " id"], ["bar", ":"], ["keys", " next"], ["bar", "_"], ["keys", "id "], ["bar", "+"],
  ["keys", " next"], ["bar", "_"], ["keys", "id"], ["bar", ","], ["keys", " title"], ["bar", ":"], ["keys", " "],
  ["bar", "\""], ["keys", "Edited"], ["bar", "\""], ["bar", ","], ["keys", " done"], ["bar", ":"], ["keys", " false "],
  ["bar", "}"], ["bar", ","], ["keys", " "],
];
if (EDIT_TODO_KEYS.map((k) => k[1]).join("") !== EDIT_TODO) throw new Error("EDIT_TODO_KEYS does not spell EDIT_TODO");

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

// [{ id, files: { name: content } }]
export function programs() {
  const fixtures = join(root, "apps/playground/tests/fixtures");
  const examples = join(root, "apps/playground/assets/examples");
  const manifest = JSON.parse(readFileSync(join(examples, "manifest.json"), "utf8"));
  const progs = readdirSync(fixtures).filter((f) => f.endsWith(".almd")).map((f) => ({ id: f, files: { "main.almd": readFileSync(join(fixtures, f), "utf8") } }));
  for (const cat of manifest.categories) if (cat.id !== "gui") for (const ex of cat.examples) {
    const files = {};
    for (const n of ex.files) files[n] = readFileSync(join(examples, ex.id, n), "utf8");
    progs.push({ id: ex.id, files });
  }
  return progs;
}

// The playground link that loads the program and runs it.
export function autorunLink(p) {
  const json = JSON.stringify({ v: 1, files: Object.entries(p.files).map(([name, content]) => ({ name, content })) });
  return `https://x.test/?autorun=1#code=${deflateRawSync(Buffer.from(json)).toString("base64url")}`;
}

// The CLI's stdout (trimmed), or null when the program uses chance or the
// clock (random / clock programs differ run to run; CLI seeding can repeat
// within a second, so two equal runs prove nothing).
export function reference(p) {
  const dir = mkdtempSync(join(tmpdir(), "pg-cli-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "almide.toml"), '[package]\nname = "fx"\nversion = "0.1.0"\n');
    for (const [n, c] of Object.entries(p.files)) writeFileSync(n.endsWith(".almd") ? join(dir, "src", n) : join(dir, n), c);
    const args = [join(root, "tools/almide"), "run", "src/main.almd"];
    const run = () => execFileSync(process.platform === "win32" ? "bash" : args[0], process.platform === "win32" ? args : args.slice(1), { cwd: dir, env: { ...process.env, PWD: dir }, encoding: "utf8", maxBuffer: 256 << 20 }).trimEnd();
    const want = run();
    const usesChance = Object.values(p.files).some((c) => /\b(random\.|env\.|time\.(now|millis)|datetime\.now)/.test(c));
    return !usesChance && run() === want ? want : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
