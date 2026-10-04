Copied from almide/playground `tests/fixtures`. Each prints `<name>: ok` and
must give byte-identical stdout natively and in the playground
(tests/e2e/fixtures.mjs). Updated for the Almide 0.66 stdlib:
`json.keys` / `json.from_*` became `value.keys` / `value.*`, and
`regex.captures` now returns the whole match first.
