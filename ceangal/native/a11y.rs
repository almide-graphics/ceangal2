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
    let forced = std::env::var("CEANGAL_A11Y").map_or(false, |v| v == "1");
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
