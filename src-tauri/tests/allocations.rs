//! The frame encoder's allocation ceiling (the plan's CI test matrix, item 6).
//!
//! `encode_frame` runs on every coalesced framebuffer update, and the frame is
//! the largest value this application moves. The claim pinned here is the
//! cheap one to state and the expensive one to lose: one buffer is allocated
//! for the whole frame — no per-rectangle temporary, no growth, no second
//! copy — so a frame of N rectangles costs one allocation and exactly the
//! bytes that cross IPC. The 4K case is included because it is the case this
//! exists for: at 3840×2160 a single frame is ~33 MB, and a second copy of it
//! is not a rounding error.
//!
//! The counting allocator only counts while a flag is up on the measuring
//! thread, so the other tests in this binary (and the harness's own threads)
//! cannot add noise to the numbers.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

struct Counting;

thread_local! {
    static MEASURING: Cell<bool> = const { Cell::new(false) };
    static ALLOCS: Cell<usize> = const { Cell::new(0) };
    static BYTES: Cell<usize> = const { Cell::new(0) };
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if MEASURING.with(Cell::get) {
            ALLOCS.with(|count| count.set(count.get() + 1));
            BYTES.with(|bytes| bytes.set(bytes.get() + layout.size()));
        }
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if MEASURING.with(Cell::get) {
            ALLOCS.with(|count| count.set(count.get() + 1));
            BYTES.with(|bytes| bytes.set(bytes.get() + new_size));
        }
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

use deskvncviewer_lib::framing::encode_frame;
use remote_core::events::{DecodedRect, RectPayload};
use remote_core::Rect;

fn rgba_rect(x: u16, y: u16, w: u16, h: u16) -> DecodedRect {
    DecodedRect {
        rect: Rect::new(x, y, w, h),
        payload: RectPayload::Rgba(vec![0u8; w as usize * h as usize * 4].into()),
    }
}

/// Allocations and bytes made by `f` on this thread.
fn measure<T>(f: impl FnOnce() -> T) -> (usize, usize) {
    ALLOCS.with(|count| count.set(0));
    BYTES.with(|bytes| bytes.set(0));
    MEASURING.with(|flag| flag.set(true));
    let out = f();
    MEASURING.with(|flag| flag.set(false));
    let measured = (ALLOCS.with(Cell::get), BYTES.with(Cell::get));
    drop(out);
    measured
}

#[test]
fn a_frame_is_one_allocation_however_many_rectangles_it_carries() {
    let rects = vec![
        rgba_rect(0, 0, 64, 64),
        rgba_rect(64, 0, 32, 32),
        rgba_rect(0, 64, 16, 16),
        rgba_rect(96, 96, 8, 8),
    ];
    let damage = Rect::new(0, 0, 128, 128);
    // Warm the encoder once: the payloads are inputs, and what this measures
    // is the frame itself.
    let frame_len = encode_frame(&rects, &damage).len();

    let (allocs, bytes) = measure(|| encode_frame(&rects, &damage));
    assert_eq!(allocs, 1, "one buffer per frame, not one per rectangle");
    assert_eq!(bytes, frame_len, "the allocation is exactly the frame");
}

#[test]
fn a_4k_frame_is_still_one_allocation() {
    let rects = vec![rgba_rect(0, 0, 3840, 2160)];
    let damage = Rect::new(0, 0, 3840, 2160);
    let frame_len = encode_frame(&rects, &damage).len();

    let (allocs, bytes) = measure(|| encode_frame(&rects, &damage));
    assert_eq!(allocs, 1, "the 4K case allocates once, not per pass");
    assert_eq!(bytes, frame_len);
    assert!(
        bytes >= 3840 * 2160 * 4,
        "the frame really carries the pixels: {bytes} bytes"
    );
}
