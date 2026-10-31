/**
 * Windowed-rendering arithmetic for the Library's grid and table.
 *
 * The Library used to mount one tile (or one table row) per host. That is fine
 * for a dozen machines and not for a few hundred: every tile carries its own
 * thumbnail request, IntersectionObserver registration and session
 * subscription, and every row a live-activity subscription. The fix is to
 * render only the rows the viewport can show, plus a small overscan, and stand
 * in for the rest with spacers of the right height.
 *
 * Everything here is in ROWS, never in items. A grid whose container is 1000px
 * wide has a column count decided by CSS; the caller derives that count from
 * the measured container width (see `gridColumns`), and a window must contain
 * whole rows or the last row of the window would be laid out on its own and
 * the responsive track count would change under it.
 *
 * Vertical only. `scrollLeft` is deliberately not an input: the grid and the
 * table scroll on the same y axis in both writing directions, RTL included,
 * and page scrolling in this app is vertical. A horizontal scrollbar inside
 * the list view moves columns, not rows; including it here would only make
 * the row window wrong.
 */

/** A contiguous run of whole rows, half open: [firstRow, lastRow). */
export interface VirtualWindow {
  /** First rendered row, 0-based. */
  firstRow: number;
  /** One past the last rendered row. */
  lastRow: number;
  /** First item index, `firstRow * columns`. */
  firstIndex: number;
  /** One past the last item index, clamped to `itemCount`. */
  lastIndex: number;
  /** Total rows in the list, whether rendered or not. */
  rowCount: number;
  /** Height of every row including the gaps between them. */
  totalHeight: number;
  /** Offset of `firstRow` from the top of the virtualized block. */
  startOffset: number;
  /** Offset of `lastRow`, clamped to `totalHeight` (no trailing gap). */
  endOffset: number;
}

export interface VirtualWindowInput {
  /** Hosts in the grid, rows in the table. */
  itemCount: number;
  /** Items per row. 1 for the list; the measured column count for the grid. */
  columns: number;
  /**
   * Height of one ROW, in px, as measured from a rendered one. For the grid
   * this is the tile's height (its 16:10 picture plus its footer), not the
   * row stride; `gap` is added here.
   */
  rowHeight: number;
  /** Vertical gap between rows. The table has none. */
  gap?: number;
  /** The scroller's visible height. Zero before the first measurement. */
  viewportHeight: number;
  /**
   * Scroll offset from the top of the virtualized block, not from the top of
   * the scroller: the block may sit below a table header or a loading band.
   */
  scrollTop: number;
  /** Extra rows above and below the viewport. */
  overscanRows?: number;
}

/** Non-negative finite helper: CSS measurements are occasionally 0/NaN. */
function size(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Height of `rowCount` rows, including the gaps between (not after) them. */
export function rowsHeight(rowCount: number, rowHeight: number, gap = 0): number {
  if (!Number.isFinite(rowCount) || rowCount <= 0) return 0;
  const count = Math.floor(rowCount);
  const row = size(rowHeight);
  const between = size(gap);
  return count * row + (count - 1) * between;
}

/**
 * Offset of a row from the top of the virtualized block.
 *
 * The stride is row + gap rather than row alone: row 2 starts after the first
 * row and the gap that follows it, which is the off-by-one-gap mistake spacer
 * layouts make most often.
 */
export function rowOffset(row: number, rowHeight: number, gap = 0): number {
  if (!Number.isFinite(row) || row <= 0) return 0;
  return Math.floor(row) * (size(rowHeight) + size(gap));
}

/**
 * How many CSS grid columns fit in `width`.
 *
 * `.host-grid` uses `repeat(auto-fit, minmax(min(100%, MIN), 1fr))`, whose
 * track count is the largest N with `N * MIN + (N - 1) * GAP <= width`. The
 * `auto-fit` collapse is why the result is capped at `itemCount`: with fewer
 * items than tracks the browser collapses the empty ones, so a two-host
 * library in a wide window really has two columns, not five.
 *
 * The grid is rendered with an explicit `repeat(N, minmax(0, 1fr))` template
 * while windowed. That is the same track sizing as the resolved `auto-fit`
 * one, but it stops a tail row of two items from collapsing to two full-width
 * tracks just because it is the only row currently mounted.
 */
export function gridColumns({
  width,
  minTileWidth,
  gap,
  itemCount,
}: {
  width: number;
  minTileWidth: number;
  gap: number;
  itemCount: number;
}): number {
  const items = Number.isFinite(itemCount) ? Math.floor(itemCount) : 0;
  if (items <= 0) return 1;
  const available = size(width);
  const min = Math.max(1, size(minTileWidth));
  const between = size(gap);
  const fit = Math.floor((available + between) / (min + between));
  return Math.max(1, Math.min(items, fit));
}

/**
 * The rows a viewport needs, with overscan, and the geometry the spacers need.
 *
 * `scrollTop` is clamped to the block's own maximum. When the host list shrinks
 * (a filter, a deletion) the scroller keeps its old offset for a frame; without
 * the clamp the window would sit below the new bottom and render nothing, which
 * looks exactly like an empty library.
 */
export function virtualWindow({
  itemCount,
  columns,
  rowHeight,
  gap = 0,
  viewportHeight,
  scrollTop,
  overscanRows = 0,
}: VirtualWindowInput): VirtualWindow {
  const items = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
  const perRow = Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
  const rowCount = items === 0 ? 0 : Math.ceil(items / perRow);
  const totalHeight = rowsHeight(rowCount, rowHeight, gap);

  const empty: VirtualWindow = {
    firstRow: 0,
    lastRow: 0,
    firstIndex: 0,
    lastIndex: 0,
    rowCount,
    totalHeight,
    startOffset: 0,
    endOffset: 0,
  };
  if (rowCount === 0) return empty;

  const row = size(rowHeight);
  const between = size(gap);
  const stride = row + between;
  // A zero-height row (a measurement that has not landed yet) gives no basis
  // for scrolling: show everything rather than divide by zero.
  if (stride <= 0) {
    return {
      ...empty,
      lastRow: rowCount,
      lastIndex: items,
    };
  }

  const viewport = size(viewportHeight);
  const maxScroll = Math.max(0, totalHeight - viewport);
  const scroll = Math.min(Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0), maxScroll);
  const over = Math.max(0, Number.isFinite(overscanRows) ? Math.floor(overscanRows) : 0);

  const firstVisible = Math.floor(scroll / stride);
  // `ceil` because a row whose top is above the viewport's bottom but whose
  // box is only partly visible is still rendered.
  const lastVisible = Math.ceil((scroll + viewport) / stride);

  const firstRow = Math.min(rowCount, Math.max(0, firstVisible - over));
  const lastRow = Math.min(rowCount, Math.max(firstRow, lastVisible + over));

  return {
    firstRow,
    lastRow,
    firstIndex: Math.min(items, firstRow * perRow),
    lastIndex: Math.min(items, lastRow * perRow),
    rowCount,
    totalHeight,
    startOffset: rowOffset(firstRow, row, between),
    endOffset: Math.min(totalHeight, rowOffset(lastRow, row, between)),
  };
}
