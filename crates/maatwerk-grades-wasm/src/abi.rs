// SPDX-License-Identifier: AGPL-3.0-or-later

//! The memory interface of the wasm module, used by `ui/src/domain/core.ts`. The JS side allocates
//! with `alloc`, writes UTF-8 text, and calls `call`. The reply's pointer and length come back
//! packed in one `u64`; the JS side reads the text and frees it with `dealloc`.
//!
//! The only `unsafe` in the grade code. Each pointer is one this module handed out with exactly
//! that length, and only the single-threaded JS side calls these.

use std::alloc::{Layout, alloc as std_alloc, dealloc as std_dealloc};

fn layout(len: usize) -> Layout {
    Layout::from_size_align(len.max(1), 1).expect("a small buffer")
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    // SAFETY: the layout has a non-zero size.
    unsafe { std_alloc(layout(len)) }
}

/// # Safety
/// `ptr` and `len` come from `alloc` or a reply of `call`, and are freed once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    // SAFETY: as the function's contract says.
    unsafe { std_dealloc(ptr, layout(len)) }
}

/// # Safety
/// `ptr` and `len` describe an initialised buffer from `alloc`.
unsafe fn text<'a>(ptr: *const u8, len: usize) -> &'a str {
    // SAFETY: as the function's contract says. The JS side's TextEncoder writes valid UTF-8;
    // anything else becomes an empty text, which gets an error reply.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    std::str::from_utf8(bytes).unwrap_or("")
}

/// # Safety
/// Both pairs describe initialised buffers from `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn call(
    name_ptr: *const u8,
    name_len: usize,
    args_ptr: *const u8,
    args_len: usize,
) -> u64 {
    // SAFETY: as the function's contract says.
    let (name, args) = unsafe { (text(name_ptr, name_len), text(args_ptr, args_len)) };
    let reply = crate::call(name, args).into_bytes();
    let len = reply.len();
    let ptr = alloc(len);
    // SAFETY: `ptr` is a fresh buffer of `len` bytes.
    unsafe { std::ptr::copy_nonoverlapping(reply.as_ptr(), ptr, len) };
    ((ptr as u64) << 32) | len as u64
}

/// Without JSON: called for every number on screen.
#[unsafe(no_mangle)]
pub extern "C" fn round1(x: f64) -> f64 {
    maatwerk_grades::round1(x)
}

#[unsafe(no_mangle)]
pub extern "C" fn round0(x: f64) -> f64 {
    maatwerk_grades::round0(x)
}

#[unsafe(no_mangle)]
pub extern "C" fn clean(x: f64) -> f64 {
    maatwerk_grades::clean(x)
}

#[unsafe(no_mangle)]
pub extern "C" fn is_fail(grade: f64) -> bool {
    maatwerk_grades::is_fail(grade)
}
