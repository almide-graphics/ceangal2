// Start options for the page (index.html): the app's wasm and every bundled
// asset (assets.json, written by tools/build_web.sh). An app replaces this
// file with `[web] boot` to add host extensions or load assets lazily.
export async function options({ base = new URL(".", import.meta.url).href } = {}) {
  const list = await (await fetch(`${base}assets.json`)).json();
  return {
    wasm: `${base}__KEY__.wasm`,
    assets: Object.fromEntries(list.map((p) => [p, `${base}assets/${p}`])),
    appId: "__ID__",
  };
}
