import { describe, expect, it } from "vitest";
import { coalesceByDamage, paintedRegion, type DamagedUpdate } from "./WebGLRenderer";
import { RectFormat } from "./frameProtocol";

// Minimal rect matching PruneRect's shape.
const jpeg = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, format: RectFormat.Jpeg });
const copy = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, format: RectFormat.CopyRect });
const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

/** An update as the renderer builds it: the painted region is computed on arrival. */
function update(rects: ReturnType<typeof jpeg>[]) {
  const damage = rects.reduce(
    (acc, r) => ({
      x: Math.min(acc.x, r.x),
      y: Math.min(acc.y, r.y),
      w: Math.max(acc.x + acc.w, r.x + r.w) - Math.min(acc.x, r.x),
      h: Math.max(acc.y + acc.h, r.y + r.h) - Math.min(acc.y, r.y),
    }),
    { x: Infinity, y: Infinity, w: 0, h: 0 },
  );
  return { rects, damage, painted: paintedRegion(rects) };
}

describe("coalesceByDamage", () => {
  it("collapses a video region across frames to the newest", () => {
    // Three frames all repainting the same region with slightly shifted tiles,
    // which the exact per-tile pruner cannot collapse.
    const u: DamagedUpdate<ReturnType<typeof jpeg>>[] = [
      { rects: [jpeg(100, 100, 40, 30)], damage: box(100, 100, 200, 150) },
      { rects: [jpeg(110, 105, 42, 28)], damage: box(100, 100, 200, 150) },
      { rects: [jpeg(105, 110, 38, 33)], damage: box(100, 100, 200, 150) },
    ];
    const r = coalesceByDamage(u);
    expect(r.kept[0]).toHaveLength(0); // superseded
    expect(r.kept[1]).toHaveLength(0); // superseded
    expect(r.kept[2]).toHaveLength(1); // newest kept
    expect(r.dropped).toBe(2);
  });

  it("keeps a menu whose damage box no video frame covers", () => {
    const u = [
      { rects: [jpeg(700, 500, 200, 300)], damage: box(700, 500, 200, 300) }, // the menu
      { rects: [jpeg(100, 100, 40, 30)], damage: box(100, 100, 200, 150) }, // video frame
      { rects: [jpeg(110, 105, 42, 28)], damage: box(100, 100, 200, 150) }, // video frame
    ];
    const r = coalesceByDamage(u);
    expect(r.kept[0]).toHaveLength(1); // menu survives
    expect(r.kept[2]).toHaveLength(1); // newest video survives
  });

  it("never drops past a CopyRect barrier", () => {
    const u = [
      { rects: [jpeg(100, 100, 40, 30)], damage: box(100, 100, 200, 150) },
      { rects: [copy(0, 0, 50, 50)], damage: box(0, 0, 50, 50) }, // barrier
      { rects: [jpeg(110, 105, 42, 28)], damage: box(100, 100, 200, 150) },
    ];
    const r = coalesceByDamage(u);
    expect(r.kept[0]).toHaveLength(1); // kept: walk stopped at the barrier above it
    expect(r.dropped).toBe(0);
  });

  it("never drops a rect the newer update did not actually paint", () => {
    // The bug this pins: the newer update painted two DISJOINT regions, and
    // the older rect lies in the gap between them. The newer update's
    // BOUNDING BOX contains the older rect, so the old coalescer dropped it —
    // and the region it covered was never painted, because the newer update
    // did not paint it either. The server does not resend it: to the server it
    // was delivered. The region stays wrong for the rest of the session.
    const u = [
      // An older update painting a region that appears for the first time.
      update([jpeg(50, 50, 10, 10)]),
      // A newer update painting two regions either side of it, and nothing
      // in between.
      update([jpeg(0, 0, 10, 10), jpeg(100, 100, 10, 10)]),
    ];
    const r = coalesceByDamage(u);
    expect(r.kept[0]).toHaveLength(1); // the region is still needed
    expect(r.kept[1]).toHaveLength(2); // both of the newer ones
    expect(r.dropped).toBe(0);
  });

  it("still drops a rect the newer update really did paint over", () => {
    // The same shape, but the newer update's rect COVERS the older one, so
    // the older one is genuinely stale and dropping it is right.
    const u = [
      update([jpeg(0, 0, 20, 20)]),
      update([jpeg(0, 0, 100, 100)]),
    ];
    const r = coalesceByDamage(u);
    expect(r.kept[0]).toHaveLength(0); // superseded
    expect(r.kept[1]).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });

  it("computes the painted region exactly when it can", () => {
    const one = paintedRegion([jpeg(10, 20, 30, 40)]);
    expect(one.exact).toBe(true);
    expect(one.boxes).toEqual([{ x: 10, y: 20, w: 30, h: 40 }]);

    // Two disjoint rects: two disjoint boxes, and the gap between them is in
    // neither.
    const two = paintedRegion([jpeg(0, 0, 10, 10), jpeg(100, 100, 10, 10)]);
    expect(two.exact).toBe(true);
    expect(two.boxes).toHaveLength(2);

    // More rects than the cover set can hold is the video case, and it says
    // so rather than pretending to be exact.
    const many = paintedRegion(
      Array.from({ length: 64 }, (_, i) => jpeg(i * 20, 0, 10, 10)),
    );
    expect(many.exact).toBe(false);
    expect(many.boxes).toHaveLength(0);
  });
});
