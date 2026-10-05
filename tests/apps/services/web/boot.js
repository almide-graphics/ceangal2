// The web build's start options: the generic ones plus this app's `twice`
// namespace, the web side of native/twice.rs. Ints arrive and return as
// BigInt, Floats as numbers.
export async function options({ base = new URL(".", import.meta.url).href } = {}) {
  const list = await (await fetch(`${base}assets.json`)).json();
  return {
    wasm: `${base}services.wasm`,
    assets: Object.fromEntries(list.map((p) => [p, `${base}assets/${p}`])),
    appId: "dev.almide.ceangal.services",
    extensions: [(host) => ({
      twice: {
        int: (n) => n * 2n,
        text_len: (ptr, len) => BigInt([...host.str(ptr, len)].length * 2),
      },
    })],
  };
}
