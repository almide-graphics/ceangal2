// Static file server over the repository root for browser tests.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".ttf": "font/ttf", ".otf": "font/otf", ".png": "image/png", ".css": "text/css", ".svg": "image/svg+xml" };

export function serve(root, port = 0) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
      if (path.includes("..")) { res.writeHead(403); return res.end(); }
      try {
        const data = await readFile(join(root, path));
        res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream", "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" });
        res.end(data);
      } catch { res.writeHead(404); res.end(); }
    });
    server.listen(port, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}
