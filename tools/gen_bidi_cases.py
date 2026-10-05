#!/usr/bin/env python3
"""Record the Unicode Bidirectional Algorithm's display order for random
short lines, as the expected results of ceangal/src/bidi_test.almd
(tests/bidi/cases.txt). The oracle is python-bidi (the unicode-bidi crate).

Usage (needs python-bidi):  python3 tools/gen_bidi_cases.py

The alphabet stays within what ceangal.bidi implements: letters of both
directions, European and Arabic-Indic digits, a mark, spaces, a tab, a
neutral, the marks LRM / RLM and every embedding, override and isolate
control. Number separators (W4–W6) and bracket pairs (N0) are left out.

Each line: the code points (hex, space-separated)<TAB>the display order
without the invisible controls.
"""
import os
import random

from bidi import get_display

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTROLS = set(range(0x202A, 0x202F)) | set(range(0x2066, 0x206A)) | {0x200E, 0x200F, 0x061C}
ALPHABET = ["a", "b", "א", "ב", "ب", "ل", "1", "2", "١", "٢", "َ", " ", " ", "!",
            "\t", "‎", "‏", "‪", "‫", "‬", "‭", "‮", "⁦", "⁧", "⁨", "⁩"]
# where python-bidi takes the paragraph direction from the first strong
# character after an override's text (P2 counts letters inside overrides)
DISPUTED = {"1‭١ב ‫"}


def main():
    rng = random.Random(13)
    lines = []
    while len(lines) < 1000:
        s = "".join(rng.choice(ALPHABET) for _ in range(rng.randint(1, 12)))
        if s in DISPUTED:
            continue
        shown = [ord(c) for c in get_display(s) if ord(c) not in CONTROLS]
        lines.append(" ".join("%X" % ord(c) for c in s) + "\t" + " ".join("%X" % c for c in shown))
    dst = os.path.join(ROOT, "tests", "bidi", "cases.txt")
    open(dst, "w").write("\n".join(lines) + "\n")
    print(f"{os.path.relpath(dst, ROOT)}: {len(lines)} lines")


if __name__ == "__main__":
    main()
