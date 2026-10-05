# ceangal guide

ceangal builds one Almide program into an app for the web, iOS, macOS,
Android, Windows and Linux, ready for each platform's store.

1. [Getting started](getting-started.md): install, make an app, run it
   everywhere.
2. [Building UI](ui.md): views, layout, input, text fields, scrolling,
   accessibility, storage and HTTP.
3. [`ceangal.toml`](ceangal-toml.md): every setting of an app.
4. [The `ceangal` CLI](cli.md): every command, and the environment the
   build scripts use.
5. [Testing](testing.md): tests that tap, type and check what is on
   screen, on the web build and the native build.
6. [Stores and signing](stores.md): icons, store listings, signing keys,
   and what each store needs from you.
7. [Native extensions](native.md): your own Rust (and JavaScript for the
   web) behind an Almide function.

The [API reference](../api/README.md) is generated from the sources. The
design decisions are in [../adr](../adr), and the host ABI every platform
implements is in [../abi.md](../abi.md).
