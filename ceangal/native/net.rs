//! `net` namespace — docs/abi.md §4.7. Each request runs on its own thread
//! (ureq); the body streams back as event-10 chunks with status
//! `1000 + http status`, then one final event with the plain status (0 and
//! the error text when the request failed). `http_cancel` stops delivery.

#![allow(dead_code)]

use std::cell::RefCell;
use std::collections::HashSet;
use std::io::Read;
use std::sync::Mutex;

#[derive(Clone, Debug, Default)]
pub struct Request {
    pub id: i64,
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
}

thread_local! {
    static OPEN: RefCell<Vec<Request>> = const { RefCell::new(Vec::new()) };
}

static CANCELLED: Mutex<Option<HashSet<i64>>> = Mutex::new(None);

fn cancelled(id: i64) -> bool {
    CANCELLED.lock().unwrap().as_ref().is_some_and(|s| s.contains(&id))
}

pub fn http_begin(method_ptr: i64, method_len: i64, url_ptr: i64, url_len: i64) -> i64 {
    let id = crate::sys::next_request_id();
    let method = crate::sys::string(method_ptr, method_len);
    let url = crate::sys::string(url_ptr, url_len);
    OPEN.with(|o| o.borrow_mut().push(Request { id, method, url, headers: Vec::new() }));
    id
}

pub fn http_header(id: i64, name_ptr: i64, name_len: i64, value_ptr: i64, value_len: i64) {
    let (n, v) = (crate::sys::string(name_ptr, name_len), crate::sys::string(value_ptr, value_len));
    OPEN.with(|o| {
        if let Some(q) = o.borrow_mut().iter_mut().find(|q| q.id == id) {
            q.headers.push((n, v));
        }
    });
}

pub fn http_send(id: i64, body_ptr: i64, body_len: i64) {
    let body = crate::sys::slice(body_ptr, body_len).to_vec();
    let Some(q) = OPEN.with(|o| {
        let mut o = o.borrow_mut();
        o.iter().position(|q| q.id == id).map(|i| o.remove(i))
    }) else { return };
    crate::sys::begin_async();
    std::thread::spawn(move || perform(q, body));
}

pub fn http_cancel(id: i64) {
    CANCELLED.lock().unwrap().get_or_insert_with(HashSet::new).insert(id);
}

fn perform(q: Request, body: Vec<u8>) {
    let id = q.id;
    let mut req = ureq::request(&q.method, &q.url);
    for (n, v) in &q.headers {
        req = req.set(n, v);
    }
    let res = if q.method == "GET" || q.method == "HEAD" { req.call() } else { req.send_bytes(&body) };
    let resp = match res {
        Ok(r) => r,
        Err(ureq::Error::Status(_, r)) => r,
        Err(e) => return crate::sys::finish_async(id, 0, Some(e.to_string().into_bytes())),
    };
    let status = resp.status() as i64;
    let mut reader = resp.into_reader();
    let mut buf = vec![0u8; 16 * 1024];
    loop {
        if cancelled(id) {
            return crate::sys::finish_async(id, 0, None);
        }
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => crate::sys::post_result(id, 1000 + status, buf[..n].to_vec()),
            Err(e) => return crate::sys::finish_async(id, 0, Some(e.to_string().into_bytes())),
        }
    }
    if cancelled(id) {
        return crate::sys::finish_async(id, 0, None);
    }
    crate::sys::finish_async(id, status, Some(Vec::new()));
}
