#!/usr/bin/env python3
"""Single source of truth for the host ABI (docs/abi.md §4).

Writes, for every namespace:
  * the Almide binding module (both @extern spellings),
  * abi/manifest.json — the list every host is checked against by
    tests/abi_conformance.mjs (JS host) and tests/abi_conformance.sh (Rust).

Run: python3 tools/gen_bindings.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

I, F, U = "Int", "Float", "Unit"

NAMESPACES = {
    # namespace: (output .almd, rust module path, [(name, [(param, type)], ret)])
    "gpu": ("snaidhm/src/gpu.almd", "crate::gpu", [
        ("surface_format", [], I),
        ("create_shader", [("src_ptr", I), ("src_len", I)], I),
        ("create_render_pipeline", [("shader", I), ("vs_ptr", I), ("vs_len", I), ("fs_ptr", I), ("fs_len", I), ("format", I), ("blend", I)], I),
        ("create_buffer", [("size", I), ("usage", I)], I),
        ("write_buffer", [("buffer", I), ("offset", I), ("ptr", I), ("len", I)], U),
        ("create_texture", [("width", I), ("height", I), ("format", I), ("usage", I)], I),
        ("write_texture", [("texture", I), ("x", I), ("y", I), ("width", I), ("height", I), ("ptr", I), ("len", I), ("bytes_per_row", I)], U),
        ("create_sampler", [("filter", I)], I),
        ("bind_begin", [], U),
        ("bind_buffer", [("binding", I), ("buffer", I)], U),
        ("bind_texture", [("binding", I), ("texture", I)], U),
        ("bind_sampler", [("binding", I), ("sampler", I)], U),
        ("bind_create", [("pipeline", I), ("group", I)], I),
        ("frame_begin", [], I),
        ("target_width", [("target", I)], I),
        ("target_height", [("target", I)], I),
        ("pass_begin", [("target", I), ("load", I), ("r", F), ("g", F), ("b", F), ("a", F)], I),
        ("pass_pipeline", [("pass", I), ("pipeline", I)], U),
        ("pass_bind", [("pass", I), ("index", I), ("group", I)], U),
        ("pass_scissor", [("pass", I), ("x", I), ("y", I), ("width", I), ("height", I)], U),
        ("pass_draw", [("pass", I), ("vertices", I), ("instances", I), ("first_vertex", I), ("first_instance", I)], U),
        ("pass_end", [("pass", I)], U),
        ("frame_submit", [], U),
        ("release", [("handle", I)], U),
        ("external_texture", [("context_id", I)], I),
    ]),
    "sys": ("ceangal/src/host/sys.almd", "crate::sys", [
        ("abi_version", [], I),
        ("run", [], U),
        ("request_frame", [], U),
        ("request_frame_after", [("ms", F)], U),
        ("now_ms", [], F),
        ("log", [("ptr", I), ("len", I)], U),
        ("event_len", [], I),
        ("event_read", [("ptr", I), ("len", I)], I),
        ("platform", [], I),
        ("set_cursor", [("kind", I)], U),
        ("set_title", [("ptr", I), ("len", I)], U),
        ("open_url", [("ptr", I), ("len", I)], U),
        ("asset_len", [("name_ptr", I), ("name_len", I)], I),
        ("asset_read", [("name_ptr", I), ("name_len", I), ("dst_ptr", I), ("dst_len", I)], I),
        ("exit", [("code", I)], U),
        ("launch_len", [], I),
        ("launch_read", [("ptr", I), ("len", I)], I),
        ("set_location", [("ptr", I), ("len", I)], U),
    ]),
    "text_input": ("ceangal/src/host/text_input.almd", "crate::text_input", [
        ("ime_begin", [("x", F), ("y", F), ("w", F), ("h", F)], U),
        ("ime_update", [("x", F), ("y", F), ("w", F), ("h", F)], U),
        ("ime_end", [], U),
    ]),
    "a11y": ("ceangal/src/host/a11y.almd", "crate::a11y", [
        ("a11y_active", [], I),
        ("a11y_begin", [], U),
        ("a11y_node", [("id", I), ("parent", I), ("role", I), ("x", F), ("y", F), ("w", F), ("h", F), ("flags", I), ("label_ptr", I), ("label_len", I)], U),
        ("a11y_value", [("id", I), ("ptr", I), ("len", I)], U),
        ("a11y_commit", [("focus_id", I)], U),
    ]),
    "clipboard": ("ceangal/src/host/clipboard.almd", "crate::clipboard", [
        ("clipboard_write", [("ptr", I), ("len", I)], U),
    ]),
    "storage": ("ceangal/src/host/storage.almd", "crate::storage", [
        ("storage_len", [("key_ptr", I), ("key_len", I)], I),
        ("storage_read", [("key_ptr", I), ("key_len", I), ("dst_ptr", I), ("dst_len", I)], I),
        ("storage_write", [("key_ptr", I), ("key_len", I), ("ptr", I), ("len", I)], U),
        ("storage_remove", [("key_ptr", I), ("key_len", I)], U),
        ("secret_len", [("key_ptr", I), ("key_len", I)], I),
        ("secret_read", [("key_ptr", I), ("key_len", I), ("dst_ptr", I), ("dst_len", I)], I),
        ("secret_write", [("key_ptr", I), ("key_len", I), ("ptr", I), ("len", I)], U),
        ("secret_remove", [("key_ptr", I), ("key_len", I)], U),
    ]),
    "net": ("ceangal/src/host/net.almd", "crate::net", [
        ("http_begin", [("method_ptr", I), ("method_len", I), ("url_ptr", I), ("url_len", I)], I),
        ("http_header", [("id", I), ("name_ptr", I), ("name_len", I), ("value_ptr", I), ("value_len", I)], U),
        ("http_send", [("id", I), ("body_ptr", I), ("body_len", I)], U),
    ]),
    # App-specific: the playground's compiler service (apps/playground/docs/runner.md).
    "runner": ("apps/playground/src/host/runner.almd", "crate::runner", [
        ("runner_version_len", [], I),
        ("runner_version_read", [("ptr", I), ("len", I)], I),
        ("runner_check", [("files_ptr", I), ("files_len", I), ("entry_ptr", I), ("entry_len", I)], I),
        ("runner_run", [("files_ptr", I), ("files_len", I), ("entry_ptr", I), ("entry_len", I)], I),
        ("runner_rust", [("files_ptr", I), ("files_len", I), ("entry_ptr", I), ("entry_len", I)], I),
        ("runner_ast", [("src_ptr", I), ("src_len", I)], I),
        ("runner_stop", [("id", I)], U),
    ]),
    "file": ("ceangal/src/host/file.almd", "crate::file", [
        ("file_open", [("kind", I)], I),
        ("file_save", [("name_ptr", I), ("name_len", I), ("ptr", I), ("len", I)], I),
    ]),
}

HEADER = """// {ns} host bindings — docs/abi.md §4.
//
// Generated by tools/gen_bindings.py; edit the table there, not this file.
// Only Int and Float cross the boundary; byte ranges are (ptr, len) from
// bytes.data_ptr.
"""

GPU_CONSTS = """
// ── Formats ──
let FORMAT_BGRA8 = 1
let FORMAT_RGBA8 = 2
let FORMAT_R8 = 3

// ── Buffer usage ──
let BUF_COPY_DST = 8
let BUF_UNIFORM = 64
let BUF_STORAGE = 128

// ── Texture usage ──
let TEX_COPY_SRC = 1
let TEX_COPY_DST = 2
let TEX_BINDING = 4
let TEX_RENDER = 16

// ── Misc enums ──
let BLEND_NONE = 0
let BLEND_PREMUL = 1
let FILTER_NEAREST = 0
let FILTER_LINEAR = 1
let LOAD_CLEAR = 0
let LOAD_KEEP = 1
"""


def main():
    manifest = {}
    for ns, (path, rust_mod, fns) in NAMESPACES.items():
        lines = [HEADER.format(ns=ns)]
        if ns == "gpu":
            lines.append(GPU_CONSTS)
        for name, params, ret in fns:
            sig = ", ".join(f"{p}: {t}" for p, t in params)
            lines.append(f'@extern(wasm, "{ns}", "{name}")')
            lines.append(f'@extern(rust, "{rust_mod}", "{name}")')
            lines.append(f"fn {name}({sig}) -> {ret} = _")
            lines.append("")
        full = os.path.join(ROOT, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write("\n".join(lines))
        manifest[ns] = [{"name": n, "params": [t for _, t in p], "ret": r} for n, p, r in fns]
    os.makedirs(os.path.join(ROOT, "abi"), exist_ok=True)
    with open(os.path.join(ROOT, "abi", "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
