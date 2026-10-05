#!/usr/bin/env python3
"""Type-check every ```almide block in docs/guide against this checkout.

Each block is checked on its own, on both targets (`almide check` and
`--target wasm`), as a module made of:
  - the imports any guide uses (ceangal, its modules, snaidhm),
  - the guide's prelude, docs/guide/examples/<guide>.prelude.almd: the
    app-side names the snippets refer to (state, handlers, colours),
  - the block; a block that is one expression (it starts with `v.`, `ed.`,
    `w.`…) becomes the body of a function returning a view.
A block that is a whole program (it has `effect fn main`) is checked as it
is. A block preceded by `<!-- not checked -->` is skipped.

  python3 tools/check_doc_examples.py            check, print each block's result
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GUIDE = ROOT / "docs/guide"
ALMIDE = ROOT / "tools/almide"

IMPORTS = """import ceangal
import ceangal.view as v
import ceangal.widgets as w
import ceangal.editor as ed
import ceangal.storage as storage
import ceangal.http as http
import snaidhm
"""

BLOCK = re.compile(r"(<!--\s*not checked\s*-->\s*\n)?```almide\n(.*?)```", re.S)


ITEM = re.compile(r"^(?:pub )?(?:effect )?(?:fn|var|let|type)\s+(\w+)", re.M)


def prelude_without(prelude: str, names: set) -> str:
    """The prelude's top-level items, less those named in `names`."""
    items, cur = [], []
    for line in prelude.splitlines():
        if line and not line[0].isspace() and not line.startswith("//") and cur:
            items.append(cur)
            cur = []
        cur.append(line)
    if cur:
        items.append(cur)
    kept = []
    for it in items:
        m = ITEM.search("\n".join(it))
        if not (m and m.group(1) in names):
            kept.append("\n".join(it))
    return "\n".join(kept)


def module_for(block: str, prelude: str) -> str:
    # a whole program, imports and all
    if "effect fn main" in block and re.search(r"^import ", block, re.M):
        return block
    prelude = prelude_without(prelude, set(ITEM.findall(block)))
    lines = [l for l in block.splitlines() if not l.startswith("import ")]
    body = "\n".join(lines).strip()
    first = body.split("\n", 1)[0]
    if re.match(r"^(v|ed|w|ceangal|snaidhm)\.", first):
        body = "fn __example() -> v.View =\n" + "\n".join("  " + l for l in body.splitlines())
    return IMPORTS + "\n" + prelude + "\n" + body + "\n"


def check(src: str, work: Path) -> list:
    f = work / "src/example.almd"
    f.write_text(src)
    errors = []
    for target in ([], ["--target", "wasm"]):
        r = subprocess.run([str(ALMIDE), "check", *target, "src/example.almd"], cwd=work, capture_output=True, text=True)
        out = r.stdout + r.stderr
        if r.returncode != 0 or "error" in out.split("No errors found")[0].lower() and "No errors found" not in out:
            errors.append(f"[{target[1] if target else 'native'}]\n" + "\n".join(l for l in out.splitlines() if l.strip())[:3000])
    return errors


def main():
    work = Path(tempfile.mkdtemp(prefix="ceangal-docs-"))
    (work / "src").mkdir()
    (work / "almide.toml").write_text(
        f'[package]\nname = "docexamples"\nversion = "0.1.0"\n\n[dependencies]\n'
        f'ceangal = {{ path = "{ROOT / "ceangal"}" }}\nsnaidhm = {{ path = "{ROOT / "snaidhm"}" }}\n')
    failed = checked = skipped = 0
    for md in sorted(GUIDE.glob("*.md")):
        prelude_file = GUIDE / "examples" / (md.stem + ".prelude.almd")
        prelude = prelude_file.read_text() if prelude_file.exists() else ""
        text = md.read_text()
        for m in BLOCK.finditer(text):
            line = text[: m.start()].count("\n") + 1 + (1 if m.group(1) else 0)
            if m.group(1):
                skipped += 1
                continue
            checked += 1
            errors = check(module_for(m.group(2), prelude), work)
            where = f"{md.relative_to(ROOT)}:{line}"
            if errors:
                failed += 1
                print(f"FAIL {where}")
                for e in errors:
                    print("     " + e.replace("\n", "\n     "))
            else:
                print(f"ok   {where}")
    print(f"\n{checked} examples checked, {failed} failed, {skipped} skipped")
    sys.exit(1 if failed else 0)


main()
