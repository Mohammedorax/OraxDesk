import { describe, expect, it } from "vitest";
import { gridColumns, rowOffset, rowsHeight, virtualWindow } from "./virtualWindow";

const grid = {
  columns: 5,
  rowHeight: 100,
  gap: 10,
  overscanRows: 2,
} as const;

describe("rowsHeight / rowOffset", () => {
  it("counts the gaps between rows, not after the last one", () => {
    expect(rowsHeight(0, 100, 10)).toBe(0);
    expect(rowsHeight(1, 100, 10)).toBe(100);
    expect(rowsHeight(3, 100, 10)).toBe(320);
    expect(rowOffset(0, 100, 10)).toBe(0);
    expect(rowOffset(3, 100, 10)).toBe(330);
  });

  it("survives a measurement that has not landed yet", () => {
    expect(rowsHeight(4, 0, 0)).toBe(0);
    expect(rowOffset(4, 0, 0)).toBe(0);
    expect(rowsHeight(Number.NaN, 100, 10)).toBe(0);
  });
});

describe("gridColumns", () => {
  const normal = { minTileWidth: 250, gap: 16 };

  it("counts the auto-fit tracks a width can hold", () => {
    expect(gridColumns({ ...normal, width: 1000, itemCount: 100 })).toBe(3);
    expect(gridColumns({ ...normal, width: 516, itemCount: 100 })).toBe(2);
    expect(gridColumns({ ...normal, width: 515, itemCount: 100 })).toBe(1);
    expect(gridColumns({ ...normal, width: 200, itemCount: 100 })).toBe(1);
  });

  it("stops at the item count, because auto-fit collapses empty tracks", () => {
    expect(gridColumns({ ...normal, width: 2000, itemCount: 2 })).toBe(2);
    expect(gridColumns({ ...normal, width: 2000, itemCount: 0 })).toBe(1);
  });

  it("follows the compact track width", () => {
    expect(gridColumns({ minTileWidth: 190, gap: 12, width: 400, itemCount: 100 })).toBe(2);
    expect(gridColumns({ minTileWidth: 190, gap: 12, width: 392, itemCount: 100 })).toBe(2);
    expect(gridColumns({ minTileWidth: 190, gap: 12, width: 391, itemCount: 100 })).toBe(1);
  });
});

describe("virtualWindow", () => {
  it("is empty for no items", () => {
    const w = virtualWindow({
      ...grid,
      itemCount: 0,
      viewportHeight: 500,
      scrollTop: 0,
    });
    expect(w).toEqual({
      firstRow: 0,
      lastRow: 0,
      firstIndex: 0,
      lastIndex: 0,
      rowCount: 0,
      totalHeight: 0,
      startOffset: 0,
      endOffset: 0,
    });
  });

  it("renders everything when there are fewer rows than a window", () => {
    // Six hosts, three columns: two rows, 210px, in a 500px viewport.
    const w = virtualWindow({
      itemCount: 6,
      columns: 3,
      rowHeight: 100,
      gap: 10,
      viewportHeight: 500,
      scrollTop: 0,
      overscanRows: 2,
    });
    expect(w.firstRow).toBe(0);
    expect(w.lastRow).toBe(2);
    expect(w.firstIndex).toBe(0);
    expect(w.lastIndex).toBe(6);
    expect(w.rowCount).toBe(2);
    expect(w.totalHeight).toBe(210);
    expect(w.startOffset).toBe(0);
    expect(w.endOffset).toBe(210);
  });

  it("renders the first rows, plus overscan, at the top", () => {
    // 100 hosts / 5 columns = 20 rows; stride 110; 400px shows rows 0-3.
    const w = virtualWindow({
      ...grid,
      itemCount: 100,
      viewportHeight: 400,
      scrollTop: 0,
    });
    expect(w.rowCount).toBe(20);
    expect(w.totalHeight).toBe(2190);
    expect(w.firstRow).toBe(0);
    expect(w.lastRow).toBe(6); // ceil(400/110) = 4 visible + 2 overscan
    expect(w.firstIndex).toBe(0);
    expect(w.lastIndex).toBe(30);
    expect(w.startOffset).toBe(0);
    expect(w.endOffset).toBe(660);
  });

  it("moves the window through the middle without losing a row", () => {
    const w = virtualWindow({
      ...grid,
      itemCount: 100,
      viewportHeight: 400,
      scrollTop: 620,
    });
    // 620 / 110 = row 5.6; 1020 / 110 = 9.27; overscan 2 on both sides.
    expect(w.firstRow).toBe(3);
    expect(w.lastRow).toBe(12);
    expect(w.firstIndex).toBe(15);
    expect(w.lastIndex).toBe(60);
    expect(w.startOffset).toBe(330);
    expect(w.endOffset).toBe(1320);
  });

  it("renders the last rows at the bottom, clamped by the end", () => {
    const w = virtualWindow({
      ...grid,
      itemCount: 100,
      viewportHeight: 400,
      scrollTop: 2190 - 400,
    });
    expect(w.firstRow).toBe(14); // floor(1790/110) = 16, minus overscan 2
    expect(w.lastRow).toBe(20); // 20 rows, never 22
    expect(w.lastIndex).toBe(100);
    expect(w.endOffset).toBe(w.totalHeight);
  });

  it("clamps overscroll to the bottom instead of rendering nothing", () => {
    const atBottom = virtualWindow({
      ...grid,
      itemCount: 100,
      viewportHeight: 400,
      scrollTop: 2190 - 400,
    });
    const beyond = virtualWindow({
      ...grid,
      itemCount: 100,
      viewportHeight: 400,
      scrollTop: 99_999,
    });
    expect(beyond).toEqual(atBottom);
    // An upward rubber band is the top, not a negative first row.
    expect(
      virtualWindow({ ...grid, itemCount: 100, viewportHeight: 400, scrollTop: -500 }),
    ).toEqual(virtualWindow({ ...grid, itemCount: 100, viewportHeight: 400, scrollTop: 0 }));
  });

  it("keeps overscan inside the list at both ends", () => {
    const short = virtualWindow({
      itemCount: 12,
      columns: 3,
      rowHeight: 100,
      gap: 10,
      viewportHeight: 100,
      scrollTop: 0,
      overscanRows: 50,
    });
    expect(short.firstRow).toBe(0);
    expect(short.lastRow).toBe(4);
    expect(short.lastIndex).toBe(12);

    const noOverscan = virtualWindow({
      ...grid,
      itemCount: 100,
      viewportHeight: 400,
      scrollTop: 620,
      overscanRows: 0,
    });
    expect(noOverscan.firstRow).toBe(5);
    expect(noOverscan.lastRow).toBe(10);

    const negative = virtualWindow({
      ...grid,
      itemCount: 100,
      viewportHeight: 400,
      scrollTop: 620,
      overscanRows: -3,
    });
    expect(negative).toEqual(noOverscan);
  });

  it("recomputes the row count and height when the columns change", () => {
    const three = virtualWindow({
      itemCount: 10,
      columns: 3,
      rowHeight: 100,
      gap: 10,
      viewportHeight: 1000,
      scrollTop: 0,
      overscanRows: 0,
    });
    const five = virtualWindow({
      itemCount: 10,
      columns: 5,
      rowHeight: 100,
      gap: 10,
      viewportHeight: 1000,
      scrollTop: 0,
      overscanRows: 0,
    });
    // 10 items / 3 = 4 rows (the last row holds one); /5 = 2 rows.
    expect(three.rowCount).toBe(4);
    expect(three.totalHeight).toBe(430);
    expect(three.lastIndex).toBe(10);
    expect(five.rowCount).toBe(2);
    expect(five.totalHeight).toBe(210);
    expect(five.lastIndex).toBe(10);
  });

  it("does not divide by a row height that has not been measured", () => {
    const w = virtualWindow({
      itemCount: 10,
      columns: 2,
      rowHeight: 0,
      gap: 0,
      viewportHeight: 400,
      scrollTop: 0,
      overscanRows: 1,
    });
    expect(w.rowCount).toBe(5);
    expect(w.totalHeight).toBe(0);
    expect(w.firstRow).toBe(0);
    expect(w.lastRow).toBe(5);
    expect(w.lastIndex).toBe(10);
  });

  it("hands the caller whole offsets to place spacer rows", () => {
    const w = virtualWindow({
      ...grid,
      itemCount: 100,
      viewportHeight: 400,
      scrollTop: 620,
    });
    // What the grid renders above its first row: three skipped rows, gaps
    // included. The grid's own gap then follows the spacer, so its top plus
    // that gap is exactly startOffset.
    expect(rowsHeight(w.firstRow, 100, 10) + 10).toBe(w.startOffset);
    // And below the window, from the end row to the true end.
    expect(rowsHeight(w.rowCount - w.lastRow, 100, 10)).toBe(w.totalHeight - w.endOffset);
  });
});
