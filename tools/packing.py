"""How the gen_*.py tools write ranges of code points into an Almide string
(a string literal costs far less wasm than a list of tuples), read back by
ceangal/src/packed.almd.

A table is rows of (first, last, values...), sorted and not overlapping. Each
row is written as numbers: first minus the previous row's last (0 before the
first row), last minus first, then the values. Each number is little-endian
base 32 in the digits below: a digit of 32 or more has another after it.
"""

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_"

# For the generated files' comments.
FORMAT = ("runs of (first − previous last, last − first, values…), each a\n"
          "// little-endian base-32 number written with 64 digits (0-9 A-Z a-z - _):\n"
          "// a digit of 32 or more has another after it (see tools/packing.py)")


def varint(v):
    assert v >= 0, v
    out = ""
    while v >= 32:
        out += DIGITS[32 + (v & 31)]
        v >>= 5
    return out + DIGITS[v]


def pack(rows):
    out, prev = "", 0
    for first, last, *values in rows:
        out += varint(first - prev) + varint(last - first) + "".join(varint(v) for v in values)
        prev = last
    return out


def unpack(s, k):
    """The rows of a packed table of k numbers per row (for tests and tools)."""
    nums, v, scale = [], 0, 1
    for ch in s:
        d = DIGITS.index(ch)
        if d >= 32:
            v += (d - 32) * scale
            scale *= 32
        else:
            nums.append(v + d * scale)
            v, scale = 0, 1
    rows, prev = [], 0
    for i in range(0, len(nums), k):
        first = prev + nums[i]
        last = first + nums[i + 1]
        rows.append([first, last, *nums[i + 2:i + k]])
        prev = last
    return rows


def literal(s, width=96):
    """The string as an Almide expression over lines of `width` characters."""
    return "\n".join('  "%s" +' % s[i:i + width] for i in range(0, len(s), width)).rstrip(" +")
