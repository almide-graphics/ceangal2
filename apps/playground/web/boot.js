// Start options shared by the page (index.html) and the E2E harness.
import { runnerExtension } from "./runner.js";

const FONTS = ["ui.ttf", "ui-semibold.ttf", "mono.ttf", "cjk.ttf"];

// Every bundled asset: fonts, the examples manifest and each example's files.
export async function playgroundAssets(base = "assets/") {
  const assets = Object.fromEntries(FONTS.map((f) => [`fonts/${f}`, `${base}fonts/${f}`]));
  const manifest = new Uint8Array(await (await fetch(`${base}examples/manifest.json`)).arrayBuffer());
  assets["examples/manifest.json"] = manifest;
  assets["examples/default.almd"] = `${base}examples/default.almd`;
  assets["ai/system.md"] = `${base}ai/system.md`;
  assets["brand/logo.rgba"] = `${base}brand/logo.rgba`;
  assets["brand/logo-dark.rgba"] = `${base}brand/logo-dark.rgba`;
  for (const cat of JSON.parse(new TextDecoder().decode(manifest)).categories)
    for (const ex of cat.examples)
      for (const f of ex.files) assets[`examples/${ex.id}/${f}`] = `${base}examples/${ex.id}/${f}`;
  return assets;
}

export async function playgroundOptions({ base = new URL(".", import.meta.url).href } = {}) {
  return {
    wasm: `${base}playground.wasm`,
    assets: await playgroundAssets(`${base}assets/`),
    appId: "almide-playground",
    extensions: [runnerExtension({ compiler: `${base}compiler/almide_compiler_service.js` })],
  };
}
export const options = playgroundOptions;
