/**
 * React plumbing for the Library's windowed rendering.
 *
 * All of the arithmetic lives in `lib/virtualWindow.ts` and is pure; this file
 * only supplies the three things it needs from the browser — where the
 * virtualized block starts inside the scroller, how tall a row is, and which
 * row currently holds focus — plus the focus pin that keeps a keyboard user
 * from being dropped on `<body>` when that row scrolls out.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type RefObject,
} from "react";

export interface ScrollWindow {
  /** Scroll offset relative to the virtualized block's top, not the scroller's. */
  scrollTop: number;
  /** The scroller's visible height, in px. */
  viewportHeight: number;
}

/**
 * Where the virtualized block sits in the scroller's content, and how much of
 * that content the scroller shows.
 *
 * The block is rarely the first thing in the scroller: the list view has a
 * table header above its rows, and the grid sits below a top bar and padding.
 * Measuring from the block's own rect (rather than assuming its offsetTop)
 * keeps the row window right when either of those changes.
 *
 * `rowStride` deliberately ROUNDS the offset down to a row boundary. A scroll
 * event fires many times inside one row, and the row window cannot change
 * until the offset crosses one; without this every frame of a smooth scroll
 * re-rendered the grid for a window that was already correct. Rounding down is
 * safe because the window starts at the row that is already at the top of the
 * viewport, and the caller's overscan covers the one row the rounded offset
 * can leave short at the bottom.
 */
export function useScrollWindow(
  scrollerRef: RefObject<HTMLElement | null>,
  blockRef: RefObject<HTMLElement | null>,
  rowStride = 0,
): ScrollWindow {
  const [metrics, setMetrics] = useState<ScrollWindow>({ scrollTop: 0, viewportHeight: 0 });

  const measure = useCallback((): void => {
    const scroller = scrollerRef.current;
    const block = blockRef.current;
    if (!scroller || !block) return;
    const top =
      block.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    const raw = Math.max(0, scroller.scrollTop - top);
    const scrollTop = rowStride > 0 ? Math.floor(raw / rowStride) * rowStride : raw;
    const viewportHeight = scroller.clientHeight;
    setMetrics((prev) =>
      prev.scrollTop === scrollTop && prev.viewportHeight === viewportHeight
        ? prev
        : { scrollTop, viewportHeight },
    );
  }, [blockRef, rowStride, scrollerRef]);

  // Also after every render: the block's position changes without a scroll
  // event when something above it appears or disappears.
  useLayoutEffect(measure);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const schedule = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    scroller.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      // Catches the window being resized and the pane being re-laid out. The
      // scroll listener alone would keep the old viewport height.
      observer = new ResizeObserver(measure);
      observer.observe(scroller);
    }
    return () => {
      scroller.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [measure, scrollerRef]);

  return metrics;
}

/**
 * The height of a rendered row, re-measured when its size changes.
 *
 * The grid's row height is the tile's aspect-ratio picture plus its footer, and
 * both follow the column width; the list's rows can be one line or two,
 * depending on how long the host's name is at the current table width. In both
 * cases the number is a MEASUREMENT, not a constant guessed from the CSS: the
 * spacer heights are what make the scrollbar honest, and a hardcoded 37px row
 * would drift by the time the table holds a few hundred of them.
 *
 * The MEDIAN of the measured rows, not the first, the smallest or the largest.
 * Collapsed table borders make the row next to a spacer half a pixel shorter
 * than an ordinary one; taking the minimum would then shorten every skipped row
 * by that half pixel and pull the scrollbar a hundred pixels off over a large
 * library. One unusually long name must not make every skipped row taller
 * either. The median of a screenful ignores both outliers, and when most rows
 * genuinely wrap it moves to the wrapped height, which is the truthful answer.
 *
 * A fallback is returned until the first commit. It only decides how much is
 * rendered before the layout effect below runs, and with the window's overscan
 * that is a handful of extra rows, never a wrong-looking one.
 */
export function useMeasuredRowHeight(
  rootRef: RefObject<HTMLElement | null>,
  selector: string,
  fallback: number,
): number {
  const [height, setHeight] = useState(fallback);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // A screenful at most: the window itself is bounded, so this is a handful
    // of layout reads after a render, not a scan of the library.
    const rows = [...root.querySelectorAll<HTMLElement>(selector)].slice(0, 32);
    if (rows.length === 0) return;
    const measure = (): void => {
      const heights: number[] = [];
      for (const row of rows) {
        const candidate = row.getBoundingClientRect().height;
        if (candidate > 0) heights.push(candidate);
      }
      if (heights.length === 0) return;
      heights.sort((a, b) => a - b);
      const next = heights[Math.floor((heights.length - 1) / 2)];
      setHeight((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const row of rows) observer.observe(row);
    return () => observer.disconnect();
  });

  return height;
}

export interface PinnedFocus {
  /** The host whose tile or row holds focus, or null. */
  focusedId: string | null;
  onFocusCapture: (e: FocusEvent<HTMLElement>) => void;
  onBlurCapture: (e: FocusEvent<HTMLElement>) => void;
}

/**
 * Keep the focused host's row mounted even after it scrolls out of the window.
 *
 * Windowing must not destroy the element that holds focus: the browser would
 * move focus to `<body>` and a keyboard user's place in the list would be gone.
 * The component using this hook includes `focusedId`'s row in the rendered set
 * whenever the ordinary window no longer contains it, so the row keeps its DOM
 * (and, with the layout effect below, its focus) at the cost of one extra row.
 *
 * Focus can still be lost for a moment when React moves that row between the
 * window and the pinned slot, which is why the effect restores it — but only
 * when focus fell to nowhere. A user who clicked or tabbed elsewhere is never
 * dragged back.
 */
export function usePinnedFocus(rootRef: RefObject<HTMLElement | null>): PinnedFocus {
  const [focusedId, setFocusedIdState] = useState<string | null>(null);
  const focusedRef = useRef<string | null>(null);

  const setFocusedId = useCallback((id: string | null): void => {
    if (focusedRef.current === id) return;
    focusedRef.current = id;
    setFocusedIdState(id);
  }, []);

  const onFocusCapture = useCallback(
    (e: FocusEvent<HTMLElement>): void => {
      const host = (e.target as HTMLElement).closest<HTMLElement>("[data-host-id]");
      if (host?.dataset.hostId) setFocusedId(host.dataset.hostId);
    },
    [setFocusedId],
  );

  /**
   * A focus move within the block keeps the pin; one out of it releases it.
   *
   * `relatedTarget === null` is deliberately NOT treated as "left": removing a
   * focused element also reports a null related target, and that is exactly
   * the moment the pin has to survive so the effect can put focus back.
   * Clicks that land on nothing focusable are caught by the pointer listener
   * below instead.
   */
  const onBlurCapture = useCallback(
    (e: FocusEvent<HTMLElement>): void => {
      const next = e.relatedTarget;
      const root = rootRef.current;
      if (next instanceof Node && root && !root.contains(next)) setFocusedId(null);
    },
    [rootRef, setFocusedId],
  );

  // Clicking the heading, a spacer or anything else outside the rows is a
  // deliberate "I am done here"; a scroll is not.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (!root) return;
      const target = e.target;
      if (!(target instanceof Element) || !target.closest("[data-host-id]")) {
        setFocusedId(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [rootRef, setFocusedId]);

  useLayoutEffect(() => {
    const id = focusedRef.current;
    if (!id) return;
    const root = rootRef.current;
    if (!root) return;
    const active = document.activeElement;
    // Focus is still somewhere real (this tile or another control): nothing to
    // restore. Only a body/document fallback means our row was torn down.
    if (active !== null && active !== document.body && active !== document.documentElement) {
      return;
    }
    const rows = root.querySelectorAll<HTMLElement>("[data-host-id]");
    for (const row of rows) {
      if (row.dataset.hostId === id) {
        // `preventScroll` is the whole point: restoring focus must not fight
        // the scroll gesture that moved the row out of the window.
        row.focus({ preventScroll: true });
        return;
      }
    }
  });

  return { focusedId, onFocusCapture, onBlurCapture };
}
