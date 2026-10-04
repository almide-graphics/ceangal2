#!/usr/bin/env python3
"""A small Markdown → standalone HTML page (headings, paragraphs, lists,
bold, links): the privacy policy published next to the web app.

  python3 tools/md_page.py in.md out.html "Title"
"""
import html
import re
import sys

src, dst, title = sys.argv[1], sys.argv[2], sys.argv[3]


def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', t)
    return re.sub(r"(?<![\"'>])(https?://[^\s<)]+)", r'<a href="\1">\1</a>', t)


out, para, items = [], [], []


def flush():
    global para, items
    if para:
        out.append("<p>" + inline(" ".join(para)) + "</p>")
        para = []
    if items:
        out.append("<ul>" + "".join("<li>" + inline(i) + "</li>" for i in items) + "</ul>")
        items = []


for line in open(src, encoding="utf-8").read().splitlines():
    m = re.match(r"(#{1,3}) (.*)", line)
    if m:
        flush()
        n = len(m.group(1))
        out.append(f"<h{n}>{inline(m.group(2))}</h{n}>")
    elif re.match(r"\s*- ", line):
        if para:
            flush()
        indent = len(line) - len(line.lstrip())
        text = line.strip()[2:]
        if indent >= 2 and items:
            items[-1] += " — " + text
        else:
            items.append(text)
    elif line.strip() == "":
        flush()
    elif items:
        items[-1] += " " + line.strip()
    else:
        para.append(line.strip())
flush()

page = f"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<style>
:root {{ color-scheme: light dark; --fg: #2b2b2b; --bg: #ffffff; --accent: #096578; }}
@media (prefers-color-scheme: dark) {{ :root {{ --fg: #f4f7f8; --bg: #0b1420; --accent: #14a2a2; }} }}
body {{ margin: 0 auto; max-width: 720px; padding: 32px 16px 64px; font: 16px/1.6 system-ui, sans-serif; color: var(--fg); background: var(--bg); }}
a {{ color: var(--accent); }} h1 {{ font-size: 1.8em; }} code {{ font-size: 0.95em; }}
</style>
{chr(10).join(out)}
</html>
"""
open(dst, "w", encoding="utf-8").write(page)
