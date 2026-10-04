//! `net` namespace — docs/abi.md §4.7. Requests are assembled here and handed
//! to the host loop, which performs them off the UI thread and delivers the
//! result as event 10. (Transport lands with the AI panel, M2.)

#![allow(dead_code)]

use std::cell::RefCell;

#[derive(Clone, Debug, Default)]
pub struct Request {
    pub id: i64,
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub sent: bool,
}

thread_local! {
    pub static REQUESTS: RefCell<(i64, Vec<Request>)> = const { RefCell::new((0, Vec::new())) };
}

pub fn http_begin(method_ptr: i64, method_len: i64, url_ptr: i64, url_len: i64) -> i64 {
    let method = crate::sys::string(method_ptr, method_len);
    let url = crate::sys::string(url_ptr, url_len);
    REQUESTS.with(|r| {
        let mut r = r.borrow_mut();
        r.0 += 1;
        let id = r.0;
        r.1.push(Request { id, method, url, ..Default::default() });
        id
    })
}

pub fn http_header(id: i64, name_ptr: i64, name_len: i64, value_ptr: i64, value_len: i64) {
    let (n, v) = (crate::sys::string(name_ptr, name_len), crate::sys::string(value_ptr, value_len));
    REQUESTS.with(|r| {
        if let Some(q) = r.borrow_mut().1.iter_mut().find(|q| q.id == id) {
            q.headers.push((n, v));
        }
    });
}

pub fn http_send(id: i64, body_ptr: i64, body_len: i64) {
    let body = crate::sys::slice(body_ptr, body_len).to_vec();
    REQUESTS.with(|r| {
        if let Some(q) = r.borrow_mut().1.iter_mut().find(|q| q.id == id) {
            q.body = body;
            q.sent = true;
        }
    });
}

/// Requests ready to perform (removed from the table).
pub fn take_sent() -> Vec<Request> {
    REQUESTS.with(|r| {
        let mut r = r.borrow_mut();
        let (sent, keep): (Vec<_>, Vec<_>) = std::mem::take(&mut r.1).into_iter().partition(|q| q.sent);
        r.1 = keep;
        sent
    })
}
