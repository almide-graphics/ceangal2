//! `a11y` namespace — docs/abi.md §4.4. ceangal rebuilds the tree after each
//! layout; the host hands the committed tree to the platform adapter.

#![allow(dead_code)]

use std::cell::RefCell;

#[derive(Clone, Debug)]
pub struct Node {
    pub id: i64,
    pub parent: i64,
    pub role: i64,
    pub rect: (f64, f64, f64, f64),
    pub flags: i64,
    pub label: String,
    pub value: Option<String>,
}

#[derive(Default)]
pub struct Tree {
    pub building: Vec<Node>,
    pub committed: Vec<Node>,
    pub focus: i64,
    pub changed: bool,
}

thread_local! {
    pub static TREE: RefCell<Tree> = RefCell::new(Tree::default());
}

/// Whether anything consumes the tree. Platform adapters (AccessKit, M4)
/// switch this on when an assistive technology connects; until then ceangal
/// skips building it. `CEANGAL_A11Y=1` forces it (tests, debugging).
pub fn a11y_active() -> i64 {
    let forced = crate::sys::test_flag("A11Y");
    if forced || ACTIVE.with(|a| a.get()) { 1 } else { 0 }
}

thread_local! {
    pub static ACTIVE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

pub fn a11y_begin() {
    TREE.with(|t| t.borrow_mut().building.clear());
}

pub fn a11y_node(id: i64, parent: i64, role: i64, x: f64, y: f64, w: f64, h: f64, flags: i64, label_ptr: i64, label_len: i64) {
    let label = crate::sys::string(label_ptr, label_len);
    TREE.with(|t| t.borrow_mut().building.push(Node { id, parent, role, rect: (x, y, w, h), flags, label, value: None }));
}

pub fn a11y_value(id: i64, ptr: i64, len: i64) {
    let v = crate::sys::string(ptr, len);
    TREE.with(|t| {
        if let Some(n) = t.borrow_mut().building.iter_mut().rev().find(|n| n.id == id) {
            n.value = Some(v);
        }
    });
}

pub fn a11y_commit(focus_id: i64) {
    TREE.with(|t| {
        let mut t = t.borrow_mut();
        t.committed = std::mem::take(&mut t.building);
        t.focus = focus_id;
        t.changed = true;
    });
}

/// Headless tests: `CEANGAL_A11Y_DUMP=<file>` gets the committed tree after
/// every settle, one node per line: role, x, y, w, h, flags, label, value
/// (tab-separated; tabs and newlines in text become spaces).
pub fn dump_if_requested() {
    let Ok(path) = std::env::var("CEANGAL_A11Y_DUMP") else { return };
    let clean = |s: &str| s.replace(['\t', '\n'], " ");
    let text: String = TREE.with(|t| t.borrow().committed.iter().map(|n| format!(
        "{}\t{:.0}\t{:.0}\t{:.0}\t{:.0}\t{}\t{}\t{}\n",
        n.role, n.rect.0, n.rect.1, n.rect.2, n.rect.3, n.flags, clean(&n.label), clean(n.value.as_deref().unwrap_or(""))
    )).collect());
    let _ = std::fs::write(path, text);
}

// ── AccessKit (windowed hosts) ──
//
// The committed tree as an AccessKit update: a window root with every node
// as a child (the tree is flat, docs/adr/0002). Bounds are physical pixels.

const ROOT: u64 = u64::MAX;

fn role_of(r: i64) -> accesskit::Role {
    use accesskit::Role::*;
    match r { 1 => Window, 3 => Button, 4 => Label, 5 => TextInput, 6 => List, 7 => ListItem, 8 => Tab, 9 => TabList, 10 => Heading, 11 => Link, 12 => CheckBox, 13 => Image, 14 => MultilineTextInput, 15 => Switch, 16 => Slider, 17 => Dialog, 18 => RadioButton, 19 => RadioGroup, 20 => ProgressIndicator, _ => GenericContainer }
}

pub fn tree_update(scale: f64, title: &str) -> accesskit::TreeUpdate {
    use accesskit::{Action, Node, NodeId, Rect, Toggled, TreeId, TreeInfo, TreeUpdate};
    TREE.with(|t| {
        let t = t.borrow();
        let mut nodes = Vec::with_capacity(t.committed.len() + 1);
        let mut root = Node::new(accesskit::Role::Window);
        root.set_label(title.to_string());
        root.set_children(t.committed.iter().map(|n| NodeId(n.id as u64)).collect::<Vec<_>>());
        nodes.push((NodeId(ROOT), root));
        for n in &t.committed {
            let mut node = Node::new(role_of(n.role));
            let (x, y, w, h) = n.rect;
            node.set_bounds(Rect { x0: x * scale, y0: y * scale, x1: (x + w) * scale, y1: (y + h) * scale });
            if !n.label.is_empty() { node.set_label(n.label.clone()); }
            if let Some(v) = &n.value { node.set_value(v.clone()); }
            if n.flags & 1 != 0 { node.add_action(Action::Focus); }
            if matches!(n.role, 3 | 8 | 11 | 12 | 15 | 18) { node.add_action(Action::Click); }
            if n.role == 16 { node.add_action(Action::Increment); node.add_action(Action::Decrement); }
            if n.flags & 8 != 0 { node.set_toggled(Toggled::True); } else if matches!(n.role, 12 | 15 | 18) { node.set_toggled(Toggled::False); }
            if n.flags & 4 != 0 { node.set_selected(true); }
            if n.flags & 16 != 0 { node.set_disabled(); }
            nodes.push((NodeId(n.id as u64), node));
        }
        let focus = if t.focus > 0 && t.committed.iter().any(|n| n.id == t.focus) { NodeId(t.focus as u64) } else { NodeId(ROOT) };
        TreeUpdate { nodes, tree: Some(TreeInfo::new(NodeId(ROOT))), tree_id: TreeId::ROOT, focus }
    })
}

/// Take "the tree changed since the last update" (set by a11y_commit).
pub fn take_changed() -> bool {
    TREE.with(|t| std::mem::replace(&mut t.borrow_mut().changed, false))
}

pub fn set_active(on: bool) { ACTIVE.with(|a| a.set(on)); }

/// An AccessKit action as an ABI event-12 action code (docs/abi.md §4.4).
pub fn action_code(a: accesskit::Action) -> Option<i64> {
    match a {
        accesskit::Action::Click => Some(1),
        accesskit::Action::Focus => Some(2),
        accesskit::Action::Increment => Some(3),
        accesskit::Action::Decrement => Some(4),
        _ => None,
    }
}

/// Android tests (`debug.ceangal.a11y` = 1): the committed tree to logcat,
/// framed by `a11y-begin <scale>` / `a11y-end`, lines as in the dump file.
pub fn log_if_requested(scale: f64) {
    // iOS (the simulator UI test): the same text, in a file
    let file = if cfg!(target_os = "android") { None } else { std::env::var("CEANGAL_A11Y_LOG").ok() };
    if !(cfg!(target_os = "android") && crate::sys::test_flag("A11Y")) && file.is_none() { return }
    let clean = |s: &str| s.replace(['\t', '\n'], " ");
    let mut out = format!("a11y-begin {scale}\n");
    TREE.with(|t| for n in &t.borrow().committed {
        out.push_str(&format!("{}\t{:.0}\t{:.0}\t{:.0}\t{:.0}\t{}\t{}\t{}\n",
            n.role, n.rect.0, n.rect.1, n.rect.2, n.rect.3, n.flags, clean(&n.label), clean(n.value.as_deref().unwrap_or(""))));
    });
    out.push_str("a11y-end");
    if let Some(path) = file {
        // written whole, then renamed: a reader never sees half a tree
        let tmp = format!("{path}.tmp");
        if std::fs::write(&tmp, &out).is_ok() { let _ = std::fs::rename(&tmp, &path); }
        return;
    }
    // logcat truncates long entries: one line per entry
    for line in out.lines() { crate::sys::log_line(line); }
}
