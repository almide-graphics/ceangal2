# Native extensions

When an app needs something ceangal does not offer, such as a sensor, a
platform SDK or a Rust crate, write it in Rust and declare it as an
Almide function. For the web build, provide the same function in
JavaScript.

[tests/apps/services](../../tests/apps/services) is a complete example
that CI builds for the web (and checks in Chrome) and natively.

## 1. The Almide side

```almide
@extern(wasm, "twice", "int")
@extern(rust, "crate::twice", "twice_int")
fn twice(n: Int) -> Int = _
```

`@extern(rust, "crate::<module>", "<fn>")` names a Rust function for the
native builds (desktop, iOS, Android). `@extern(wasm, "<namespace>",
"<name>")` names the import the web build gets from JavaScript. An app
that builds for the web needs both.

Only `Int` (i64) and `Float` (f64) cross the boundary in both directions.
Pass text and bytes as a pointer and a length:

```almide
@extern(wasm, "twice", "text_len")
@extern(rust, "crate::twice", "twice_text_len")
fn twice_text_len(ptr: Int, len: Int) -> Int = _

fn twice_len(s: String) -> Int = {
  let b = bytes.from_string(s)
  // bound, not returned directly: a value-returning call in tail position
  // sees its Bytes already freed on wasm (almide/almide#3420)
  let n = twice_text_len(bytes.data_ptr(b), bytes.len(b))
  n
}
```

## 2. Rust, for the native builds

```toml
[native]
dir = "native"
deps = { }            # any crates the module uses, as in Cargo.toml
```

Each `native/<module>.rs` becomes `crate::<module>` in the generated
crate:

```rust
// native/twice.rs
pub fn twice_int(n: i64) -> i64 { n * 2 }

pub fn twice_text_len(ptr: i64, len: i64) -> i64 {
    let s = crate::sys::string(ptr, len);
    (s.chars().count() * 2) as i64
}
```

The framework's own modules share the crate, so their helpers are
available:

| | |
|---|---|
| `crate::sys::string(ptr, len) -> String` | read text the app passed |
| `crate::sys::next_request_id()`, `begin_async()`, `finish_async(id, status, Some(body))` | answer later (from any thread). The app gets `(id, status, body)` in `on_result`, as with `ceangal.http` |
| `crate::sys::post_result(id, status, body)` | a partial answer before the final one |

A function that differs per platform uses `#[cfg(target_os = "ios")]`
and the like. Platform SDKs are reached through crates: `objc2` on Apple
platforms, `jni` on Android, `windows` on Windows.

## 3. JavaScript, for the web build

A `[web] boot` file replaces the generic start options and adds the
namespace:

```toml
[web]
boot = "web/boot.js"
```

```js
// web/boot.js
export async function options({ base = new URL(".", import.meta.url).href } = {}) {
  const list = await (await fetch(`${base}assets.json`)).json();
  return {
    wasm: `${base}services.wasm`,                       // <key>.wasm
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
```

An extension is a function of the host that returns namespaces of
imports. Ints arrive and must return as `BigInt`; Floats are numbers.
`host.str(ptr, len)` and `host.bytes(ptr, len)` read the app's memory,
and `host.deliver(id, status, bytes)` answers an asynchronous request
(the app gets it in `on_result`).

## Larger extensions

The [playground](../../apps/playground/ceangal.toml) embeds the whole
Almide compiler this way. A native module runs it in-process and links
the user's program into a wasm interpreter (`[native] deps` names the
compiler crate and wasmi). The web build has a worker that runs the
compiler's own wasm build (`[web] boot` and `prebuild`).
