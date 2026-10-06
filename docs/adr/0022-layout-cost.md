# ADR 0022 — Layout cost: measure each node once, flatten without subtrees

## Context
The gallery's controls page took 10 ms a frame natively (a Mac, headless,
scrolling 120 frames). A phone is several times slower, so that is well
past a 60 fps frame. Painting was under 1 ms of it. A profile showed two
causes:
- **Flex measuring was exponential in depth.** `build_lines` measures each
  child twice, once for its basis and once for its cross size. Each
  measure builds the child's own lines, which measures its children twice,
  and so on. `do_layout` then measured again at every level.
- **The flattened view list held whole subtrees.** `frame_views[i]` kept
  its children, so every read of it copied its subtree, and for the root
  that is the whole tree. Hit testing, hover, the wheel, accessibility and
  scroll handling all read it once per view.

## Decision
- **`compute_size` remembers its answers for one layout.**
  - The runtime numbers the nodes as `to_node` builds them (`Node.id`).
  - The answer is keyed by the id, the available width and height, and the
    node's own width and height. The parent fills in percentage sizes
    during layout, so these can change.
  - The table is cleared before and after each layout.
  - Nodes built by hand (`id` -1, as in `layout_test.almd`) are measured
    as before.
- **`flatten` stores each view without its children**, and keeps each
  view's subtree length in `frame_sizes`. Scrolling and overlays read that
  length instead of walking the subtree again.

## Consequences
- The gallery takes 3.1 ms a frame instead of 10.0 ms, and the pixels are
  identical byte for byte. The layout, pixel, `ceangal test` and E2E
  suites pass unchanged.
- A `Map` keyed by id beats a list of lists: 3.1 ms against 3.9 ms, for
  220 bytes more wasm.
- The wasm stays within budget, with little room left:

  | App | Optimized wasm | Budget |
  |---|---|---|
  | gallery | 185.8 KB | 186 KB |
  | todo | 161.7 KB | 162 KB |
  | hello | 159.2 KB | 160 KB |

  The next control will need a budget increase, or a cut somewhere else.
