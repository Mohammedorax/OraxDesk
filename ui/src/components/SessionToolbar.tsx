/** Floating pill session toolbar (PRD/05 §2): draggable anywhere in the window
 *  and docking flush when dropped near an edge, never able to leave the
 *  viewport, auto-fades to a chevron after 3s of pointer OR key idle or when
 *  put away by hand (which is remembered for the next session, unlike the
 *  idle fade), recalled by its chevron or Ctrl/Cmd+Shift+M, which also puts it
 *  away again. Its position is remembered and shared by every mounted
 *  toolbar. When its pane is too narrow for all its buttons the weakest
 *  groups fold into one overflow menu instead of the bar wrapping or
 *  clipping; which groups, and in what order, is `lib/toolbarLayout`. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  DisplayOption,
  ProtocolKind,
  QualityPreset,
  ScalingMode,
  SessionState,
  SessionStats,
} from "../lib/types";
import { useT, type Translate } from "../lib/i18n";
import type { LocalCursor } from "../state/SettingsContext";
import type { CaptureStatus } from "../lib/tauri";
import { classNames, formatBps, fullscreenHint, isMac, modKeyLabel } from "../lib/util";
import {
  collapseToolbarGroups,
  TOOLBAR_MENU_GROUPS,
  type ToolbarGroupId,
} from "../lib/toolbarLayout";
import { usePaneVisible } from "./Pane";
import {
  IconActivity, IconCamera, IconChevronDown, IconClipboard, IconCommand, IconDisconnect, IconEye,
  IconFile, IconGripVertical, IconKeyboard, IconMaximize, IconMonitor, IconMore, IconPin,
  IconCursor, IconRefresh, IconSearch, IconSplitDown, IconSplitRight, IconTerminal,
} from "./icons";

type Edge = "top" | "bottom" | "left" | "right";

interface ToolbarPos {
  /** The edge it is docked to, or null when floating free. */
  edge: Edge | null;
  /** Where along that edge its centre sits, 0..1. Unused while floating. */
  ratio: number;
  /** Top-left as a fraction of the viewport. Unused while docked. */
  x: number;
  y: number;
}

const POS_KEY = "deskvnc.toolbar.pos";
const PIN_KEY = "deskvnc.toolbar.pin";
const IDLE_MS = 3000;
/**
 * How long the bar stays open after a session opens, before it is allowed to
 * fade to a chevron on its own.
 */
const FRESH_MS = 9000;
/** Gap kept between the toolbar and the edges of the window. */
const MARGIN = 12;
/**
 * What the pill costs beyond the room between its own edges: `px-1.5` and a
 * one-pixel border on each side, padded, because the folding budget must err
 * toward fitting rather than toward a bar a few pixels too wide.
 */
const ROW_INSET_PX = 16;
/** Drag within this many pixels of an edge and it docks there. */
const SNAP_PX = 40;
/** Travel before a press counts as a drag rather than a click. */
const DRAG_SLOP = 4;

/**
 * The chord that takes the keyboard back from the remote.
 *
 * Named once so the sentences that mention it cannot drift apart, and passed
 * into the catalogue as a value rather than written into it.
 */
const RELEASE_CHORD = "Ctrl+Alt+Shift+Esc";

const DEFAULT_POS: ToolbarPos = { edge: "top", ratio: 0.5, x: 0.5, y: 0 };

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);

/**
 * Stored positions predate free placement and carry only `{edge, ratio}`, so
 * anything missing is filled from the default rather than trusted: a `NaN`
 * left over from an older shape would put the toolbar nowhere at all.
 */
function readPos(): ToolbarPos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ToolbarPos>;
      const edge =
        p.edge === "top" || p.edge === "bottom" || p.edge === "left" || p.edge === "right"
          ? p.edge
          : p.edge === null
            ? null
            : DEFAULT_POS.edge;
      const num = (v: unknown, fallback: number): number =>
        typeof v === "number" && Number.isFinite(v) ? v : fallback;
      return {
        edge,
        ratio: num(p.ratio, DEFAULT_POS.ratio),
        x: num(p.x, DEFAULT_POS.x),
        y: num(p.y, DEFAULT_POS.y),
      };
    }
  } catch {
    /* default below */
  }
  return DEFAULT_POS;
}

const readPinned = (): boolean => localStorage.getItem(PIN_KEY) === "1";

/**
 * Where the toolbar sits, and whether it stays put, is one preference for the
 * whole app. In tabbed view several toolbars are mounted at once and each one
 * took its own snapshot when it mounted, so dragging the toolbar in one tab
 * left every other tab's where it was until the app restarted. A `storage`
 * event does not fire in the document that wrote the value, so the writer has
 * to tell its siblings itself.
 */
const layoutListeners = new Set<() => void>();

function storeLayout(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable, the position is simply not remembered */
  }
  for (const notify of layoutListeners) notify();
}

export interface SessionToolbarProps {
  desktopName: string;
  /**
   * Which protocol this session speaks. Four rows differ, and each for its
   * own reason, written out where it is gated rather than as a list here.
   */
  protocol: ProtocolKind;
  state: SessionState;
  stats: SessionStats | null;
  /** The renderer's queue, so the shedding is visible. */
  queueStats?: { depth: number; bytes: number; droppedRects: number; droppedUpdates: number } | null;
  scalingMode: ScalingMode;
  zoom: number;
  quality: QualityPreset;
  bwLevels: number;
  passthrough: boolean;
  /** Live native-capture state from the shell (PRD/06 §3 Tier 2). */
  captureStatus: CaptureStatus;
  viewOnly: boolean;
  recallSignal: number;
  /**
   * The bar is put away: folded to its chevron, which is also the control
   * that brings it back. Not "not rendered" — a bar that is not there cannot
   * offer the way back, which is the bug this state exists to fix.
   */
  hidden: boolean;
  /**
   * A deliberate show/hide, reported so the choice outlives this session.
   * The idle timer's own folding never comes through here: that is the bar
   * getting out of the way, not the person putting it away.
   */
  onHiddenChange: (hidden: boolean) => void;
  onScalingMode: (m: ScalingMode) => void;
  onZoom: (z: number) => void;
  zoomLocked: boolean;
  onZoomLocked: (locked: boolean) => void;
  edgePan: boolean;
  onEdgePan: (on: boolean) => void;
  /**
   * Rows for the Displays menu: real monitors, or synthetic splits, already
   * in the order to show them. Ordered by the caller so this menu and the
   * native View ▸ Displays submenu number the monitors the same way.
   */
  screens: DisplayOption[];
  /** True when `screens` is the server's own layout rather than guesses. */
  layoutKnown: boolean;
  /** Selected option id, or null for the whole desktop. */
  displayId: number | null;
  onDisplay: (id: number | null) => void;
  /** Re-run the monitor-seam detector (only offered when the layout is guessed). */
  onDetectDisplays: () => void;
  showRemoteCursor: boolean;
  onShowRemoteCursor: (show: boolean) => void;
  localCursor: LocalCursor;
  onLocalCursor: (mode: LocalCursor) => void;
  onQuality: (q: QualityPreset) => void;
  alwaysRefresh: boolean;
  onAlwaysRefresh: (enabled: boolean) => void;
  onBwLevels: (levels: number) => void;
  onPassthrough: (v: boolean) => void;
  /** Open the "why we need Accessibility" explainer before any OS prompt. */
  onCapturePermission: () => void;
  onSendCombo: (combo: "ctrl-alt-del" | "cmd-tab" | "win" | "alt-f4" | "escape") => void;
  onClipboardSend: () => void;
  /** Open the dual-pane file manager (PRD/08 §3.2). */
  onFiles: () => void;
  /**
   * `null` while the SSH probe is still running, `false` when SSH is
   * unreachable, the button is then disabled with an explanation rather than
   * hidden, so "why can't I send files?" has an answer (PRD/08 §5).
   */
  filesAvailable: boolean | null;
  /** Open a remote shell (ssh-core). Same reachability gate as `onFiles`. */
  onTerminal: () => void;
  terminalAvailable: boolean | null;
  onFullscreen: () => void;
  onViewOnly: (v: boolean) => void;
  onScreenshot: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
  /**
   * Divide this pane, putting the new one to the right or underneath.
   *
   * Absent for a session in a window of its own, where there are no panes to
   * divide and the buttons are simply not drawn.
   */
  onSplit?: (dir: "row" | "column") => void;
  /**
   * The box the toolbar has to stay inside, in viewport coordinates.
   *
   * Omitted for a session that has the window to itself, where the box is the
   * window less whatever `--session-inset-top` reserves at the top. A session
   * in a split pane passes its pane's rectangle instead, so the bar belongs to
   * the view it controls rather than floating over a neighbour and offering
   * that machine's disconnect button to the wrong desktop.
   */
  frame?: { x: number; y: number; width: number; height: number };
}

export function SessionToolbar(props: SessionToolbarProps): ReactNode {
  const t = useT();
  const [pos, setPos] = useState<ToolbarPos>(readPos);
  const [pinned, setPinned] = useState<boolean>(readPinned);
  /** Latest position, for the drag handler to persist on drop. */
  const posRef = useRef(pos);
  posRef.current = pos;
  const owns = usePaneVisible();

  // Follow the shared layout while other tabs' toolbars are mounted alongside.
  useEffect(() => {
    const sync = (): void => {
      setPos(readPos());
      setPinned(readPinned());
    };
    layoutListeners.add(sync);
    return () => {
      layoutListeners.delete(sync);
    };
  }, []);

  /**
   * Folded to the chevron. It starts folded when the stored choice says so,
   * and follows that choice when the View menu or Preferences changes it
   * underneath a mounted bar.
   *
   * Kept as its own state rather than derived from the prop because the idle
   * timer folds the bar without that being a choice: deriving would put a
   * bar that folded itself back out on the next render.
   */
  const [collapsed, setCollapsed] = useState(props.hidden);
  useEffect(() => {
    setCollapsed(props.hidden);
  }, [props.hidden]);
  /** Through a ref: the parent rebuilds this callback on every render. */
  const onHiddenChangeRef = useRef(props.onHiddenChange);
  onHiddenChangeRef.current = props.onHiddenChange;
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const idleTimer = useRef(0);
  const dragging = useRef(false);
  /**
   * The first seconds after the session opens, the bar stays out.
   *
   * The bar fades to a chevron after three seconds of no interaction, which
   * is right for a person who is working and wrong for a person who has just
   * connected and is looking for the button that makes the screen fullscreen.
   * A chevron nobody knows is a button is not a control.
   */
  const [fresh, setFresh] = useState(true);
  const freshRef = useRef(true);
  freshRef.current = fresh;
  /** Read inside callbacks that must not collapse an already-collapsed bar. */
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  /**
   * Keeping the toolbar on screen needs three numbers the CSS cannot supply:
   * how big the window is, how big the toolbar is, and how much room the shell
   * chrome takes at the top. Clamping the anchor point alone is not enough,
   * because the anchor is the toolbar's centre; the box around it is what has
   * to stay inside, and it changes width as buttons appear and disappear.
   */
  const [windowSize, setWindowSize] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [windowInsetTop, setWindowInsetTop] = useState(0);

  useEffect(() => {
    const measure = (): void => {
      setWindowSize({ w: window.innerWidth, h: window.innerHeight });
      const raw = getComputedStyle(document.documentElement).getPropertyValue(
        "--session-inset-top",
      );
      setWindowInsetTop(parseFloat(raw) || 0);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [owns]);

  /**
   * Everything below works in coordinates local to whatever the toolbar is
   * confined to, so a pane and a whole window are the same problem with
   * different numbers. `origin` is what turns the answer back into the
   * viewport coordinates a `position: fixed` box wants.
   *
   * A pane rectangle already starts below the tab strip, so a framed toolbar
   * needs no inset of its own; the shell's inset only exists to keep a
   * window-wide toolbar off the tabs.
   */
  const { frame } = props;
  const origin = useMemo(
    () => (frame ? { x: frame.x, y: frame.y } : { x: 0, y: 0 }),
    [frame],
  );
  const viewport = useMemo(
    () => (frame ? { w: frame.width, h: frame.height } : windowSize),
    [frame, windowSize],
  );
  const insetTop = frame ? 0 : windowInsetTop;

  // The collapsed chevron is a fraction of the width of the open toolbar, and
  // the open one grows and shrinks with the capture badge, so the box is
  // measured as it renders rather than assumed.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize((prev) =>
        Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
          ? prev
          : { w: r.width, h: r.height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed]);

  /**
   * Measure after every render as well, not only when the observer says so.
   *
   * The observer covers a box that changes without us re-rendering (a font
   * finishing loading, say). This covers the reverse, and it is the case that
   * matters: the width decides whether the bar fits its pane at all, and a
   * measurement that never arrives leaves it drawn across the pane next door.
   * `setSize` returns the previous object when nothing moved, so a render that
   * changes nothing costs one `getBoundingClientRect` and no second pass.
   */
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize((prev) =>
      Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5
        ? prev
        : { w: r.width, h: r.height },
    );
  });

  /**
   * Measure each group of buttons as it renders, so the bar can decide which
   * groups have to fold to fit its pane (see `lib/toolbarLayout`). The
   * question is asked in real widths for the same reason the bar itself is
   * measured rather than assumed: an estimate would either clip the bar at
   * the pane's edge or fold away controls that in fact fit.
   *
   * A folded group unmounts and reports no width; its last measurement is
   * kept, because it is still the right answer to "how much room comes back
   * if this group comes back", and re-measuring it would mean rendering the
   * buttons being avoided. `setGroupWidths` returns the previous object when
   * nothing moved, so a settled bar costs one pass of `getBoundingClientRect`
   * per visible group and no second render.
   */
  const [groupWidths, setGroupWidths] = useState<Partial<Record<ToolbarGroupId, number>>>({});
  const groupEls = useRef(new Map<ToolbarGroupId, HTMLElement>());
  const setGroupEl = useCallback(
    (id: ToolbarGroupId) =>
      (el: HTMLElement | null): void => {
        if (el) groupEls.current.set(id, el);
        else groupEls.current.delete(id);
      },
    [],
  );

  useLayoutEffect(() => {
    setGroupWidths((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, el] of groupEls.current) {
        const w = el.getBoundingClientRect().width;
        if (w > 0 && Math.abs((next[id] ?? -1) - w) >= 0.5) {
          next[id] = w;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  });

  /** The widest the bar may be where it sits, and the room that leaves for
   *  the buttons once the pill's own padding and border are taken out. */
  const maxBarWidth = Math.max(0, viewport.w - 2 * MARGIN);
  const room = Math.max(0, maxBarWidth - ROW_INSET_PX);
  const collapsedGroups = useMemo(
    () => collapseToolbarGroups(groupWidths, room),
    [groupWidths, room],
  );
  /** The folded groups that get an entry in the overflow menu. */
  const overflowGroups = TOOLBAR_MENU_GROUPS.filter((id) => collapsedGroups.has(id));

  /**
   * Fold to the chevron because nobody is using it.
   *
   * Auto-hide is not a choice, so it never reaches `onHiddenChange`: a bar
   * that folded itself while the person was away must be out again on the
   * next connect, the same way it was before they looked away.
   */
  const fold = useCallback((): void => {
    if (collapsedRef.current) return;
    window.clearTimeout(idleTimer.current);
    setOpenMenu(null);
    setCollapsed(true);
  }, []);

  /**
   * Put the bar away by hand, and say so: this one is remembered.
   *
   * The chevron drawn in its place is the way back, and the chord is the
   * other; both end in `show`. Reaching this from the idle timer would make
   * every unattended session start collapsed next time, which is why the
   * timer uses `fold` instead.
   */
  const hide = useCallback((): void => {
    fold();
    onHiddenChangeRef.current(true);
  }, [fold]);

  const show = useCallback((): void => {
    setCollapsed(false);
    onHiddenChangeRef.current(false);
  }, []);

  /**
   * True while the pointer is over the toolbar.
   *
   * Auto-hide is driven by activity, and a pointer RESTING on the toolbar
   * generates no events at all, so the thing collapsed out from under the
   * cursor, which is the one moment it is obviously wanted.
   */
  const hovering = useRef(false);

  const armIdle = useCallback((): void => {
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      // Still in the grace period after the session opened: leave the bar
      // where it is. Activity re-arms this, and so does the timer below when
      // the grace period ends.
      if (freshRef.current) return;
      if (!pinned && !dragging.current && !hovering.current) fold();
    }, IDLE_MS);
  }, [pinned, fold]);

  // The grace period ends on its own, and the bar starts behaving normally
  // from there whether the person has touched anything or not.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFresh(false);
      armIdle();
    }, FRESH_MS);
    return () => window.clearTimeout(timer);
  }, [armIdle]);

  // Only the focused pane's toolbar watches the pointer. A toolbar belonging to
  // any other pane is not drawn at all, and one that still ran this would reset
  // an idle timer on every mouse move for a bar nobody can see.
  //
  // The keyboard is watched as well as the pointer, and it has to be: auto-hide
  // is armed by activity, and a person who works the keyboard alone never
  // generates a `pointermove` at all. Their bar folded away three seconds
  // after the session opened and the only way back was the Ctrl/Cmd+Shift+M
  // chord, which is a thing they have to be told about and cannot discover.
  // A key press is activity, so it re-arms the timer like any other.
  useEffect(() => {
    if (!owns) return;
    armIdle();
    const wake = (): void => armIdle();
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
      window.clearTimeout(idleTimer.current);
    };
  }, [armIdle, owns]);

  /**
   * Show/hide via the hotkey (the parent bumps `recallSignal`). It toggles, so
   * the chord that calls the toolbar back also puts it away; the effect has to
   * act only on a genuine bump, since `fold` and `collapsed` change its
   * identity too and re-running on those would flip the toolbar unbidden.
   *
   * Both directions are the remembered kind: the chord is as deliberate as the
   * button, and a bar called back this way is still there next session.
   */
  const lastRecall = useRef(props.recallSignal);
  useEffect(() => {
    if (props.recallSignal === lastRecall.current) return;
    lastRecall.current = props.recallSignal;
    if (collapsed) {
      show();
      armIdle();
    } else {
      hide();
    }
  }, [props.recallSignal, collapsed, show, hide, armIdle]);

  useEffect(() => {
    if (openMenu === null) return;
    const close = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [openMenu]);

  // ------------------------------------------------------------------ drag

  /**
   * The rectangle the toolbar's top-left corner is allowed to occupy.
   *
   * `--session-inset-top` is how much room the shell's own chrome takes: in
   * tabbed view the top of the viewport is the tab strip, and a toolbar placed
   * over it would swallow the clicks meant for the tabs. A session window
   * publishes nothing and the inset is simply zero.
   *
   * The `Math.max` guards a window narrower than the toolbar, where the lower
   * bound would otherwise exceed the upper one and clamp would return the
   * wrong end. Pinning it to the near edge at least keeps the drag handle
   * reachable.
   */
  const bounds = useMemo(() => {
    const minX = MARGIN;
    const minY = insetTop + MARGIN;
    return {
      minX,
      minY,
      maxX: Math.max(minX, viewport.w - size.w - MARGIN),
      maxY: Math.max(minY, viewport.h - size.h - MARGIN),
    };
  }, [viewport, size, insetTop]);

  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const originRef = useRef(origin);
  originRef.current = origin;

  /**
   * Drag the whole toolbar by whatever was grabbed: the grip when open, the
   * chevron itself when collapsed.
   *
   * The chevron is also the button that reopens the toolbar, so a press has to
   * mean one thing or the other. Nothing moves until the pointer has travelled
   * `DRAG_SLOP`, and a press that never gets that far is left alone to become
   * an ordinary click. `draggedRef` then tells that click to stand down, since
   * the browser still fires one after a drag that begins and ends on the same
   * element. It is cleared on a timer rather than in the click handler so a
   * drag which ends elsewhere, firing no click at all, cannot leave the flag
   * raised and swallow the next real one.
   */
  const draggedRef = useRef(false);

  const beginDrag = (e: React.PointerEvent): void => {
    e.preventDefault();
    dragging.current = true;
    draggedRef.current = false;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    // Grab the toolbar where it was actually taken hold of, so it does not
    // jump to centre itself under the pointer on the first move.
    const rect = rootRef.current?.getBoundingClientRect();
    const grabX = rect ? e.clientX - rect.left : 0;
    const grabY = rect ? e.clientY - rect.top : 0;
    const fromX = e.clientX;
    const fromY = e.clientY;

    const move = (ev: PointerEvent): void => {
      if (!draggedRef.current) {
        if (Math.hypot(ev.clientX - fromX, ev.clientY - fromY) < DRAG_SLOP) return;
        draggedRef.current = true;
      }
      const { w: W, h: H } = viewportRef.current;
      const { w, h } = sizeRef.current;
      const b = boundsRef.current;
      // The pointer speaks viewport coordinates; the bounds are local to
      // whatever the toolbar is confined to, so meet in the middle.
      const o = originRef.current;
      const left = clamp(ev.clientX - grabX - o.x, b.minX, b.maxX);
      const top = clamp(ev.clientY - grabY - o.y, b.minY, b.maxY);

      // Distance from each edge of the window to the matching edge of the box.
      const dTop = top - b.minY;
      const dBottom = b.maxY - top;
      const dLeft = left - b.minX;
      const dRight = b.maxX - left;
      const nearest = Math.min(dTop, dBottom, dLeft, dRight);

      if (nearest > SNAP_PX) {
        setPos({ edge: null, ratio: 0, x: left / W, y: top / H });
        return;
      }
      let edge: Edge = "top";
      if (nearest === dBottom) edge = "bottom";
      else if (nearest === dLeft) edge = "left";
      else if (nearest === dRight) edge = "right";
      // Store the centre along the edge, so the dock survives a resize.
      const span = edge === "top" || edge === "bottom" ? W : H - insetTop;
      const centre =
        edge === "top" || edge === "bottom" ? left + w / 2 : top + h / 2 - insetTop;
      setPos({ edge, ratio: clamp(span > 0 ? centre / span : 0.5, 0, 1), x: left / W, y: top / H });
    };

    const up = (): void => {
      dragging.current = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (draggedRef.current) {
        // Through a ref, not a `setPos` updater: an updater has to be pure,
        // and this one now tells the other mounted toolbars about the move.
        storeLayout(POS_KEY, JSON.stringify(posRef.current));
        // Outlives the click the browser is about to fire, then stops being
        // able to suppress anything.
        window.setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }
      armIdle();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /**
   * Absolute placement, always clamped to `bounds`.
   *
   * Everything resolves to a plain left/top with no centring transform: the
   * old version anchored the toolbar's *centre* and clamped that, which let
   * half the box hang outside the window with the drag handle out of reach.
   * Clamping the corner is what actually keeps it on screen.
   */
  const style = useMemo((): React.CSSProperties => {
    const { w: W, h: H } = viewport;
    const { w, h } = size;
    const b = bounds;
    let left: number;
    let top: number;
    switch (pos.edge) {
      case "top":
      case "bottom":
        left = clamp(pos.ratio * W - w / 2, b.minX, b.maxX);
        top = pos.edge === "top" ? b.minY : b.maxY;
        break;
      case "left":
      case "right":
        left = pos.edge === "left" ? b.minX : b.maxX;
        top = clamp(insetTop + pos.ratio * (H - insetTop) - h / 2, b.minY, b.maxY);
        break;
      default:
        left = clamp(pos.x * W, b.minX, b.maxX);
        top = clamp(pos.y * H, b.minY, b.maxY);
    }
    return { position: "fixed", zIndex: 30, left: origin.x + left, top: origin.y + top };
  }, [pos, viewport, size, insetTop, bounds, origin]);

  // Floating toolbars open their menus downwards unless they sit low enough
  // that the menu would run off the bottom.
  const menuBelow =
    pos.edge === "bottom"
      ? false
      : pos.edge !== null || style.top === undefined
        ? true
        : Number(style.top) - origin.y < viewport.h * 0.6;

  // Zero means "never measured", not "instant": the core leaves it at 0 until
  // a probe completes, and a session showing a confident "0ms" while the real
  // round trip was ~290ms is worse than showing nothing (issue #1).
  const rtt = props.stats?.rtt_ms ?? null;
  const latency = rtt !== null && rtt > 0 ? rtt : null;
  const latencyColor =
    latency === null ? "bg-tertiary/50" : latency < 40 ? "bg-success" : latency < 120 ? "bg-warning" : "bg-danger";

  const capturing = props.captureStatus.state === "active";

  /**
   * Labels shared by a bar button and the overflow-menu row that stands in
   * for it when the group is folded, so the two cannot drift into saying
   * different things about the same control.
   */
  const filesLabel =
    props.filesAvailable === true
      ? t("session.fileTransfer")
      : props.filesAvailable === null
        ? t("session.checkingSsh")
        : t("session.filesNeedSsh");
  const terminalLabel =
    props.terminalAvailable === true
      ? t("session.terminal")
      : props.terminalAvailable === null
        ? t("session.checkingSsh")
        : t("session.terminalNeedSsh");
  const splitRightLabel = `${t("about.shortcut.splitRight")} (${modKeyLabel}⌥D)`;
  const splitDownLabel = `${t("about.shortcut.splitDown")} (${modKeyLabel}⌥⇧D)`;
  const viewOnlyLabel = props.viewOnly ? t("session.viewOnlyOn") : t("session.viewOnlyOff");

  if (collapsed) {
    // The capture indicator survives collapse on purpose: PRD/06 §3 requires
    // the user to always be able to see that their keyboard is grabbed.
    return (
      <div ref={rootRef} style={style} className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={t("session.showToolbar", { chord: `${modKeyLabel}⇧M` })}
          title={t("session.showToolbar", { chord: `${modKeyLabel}⇧M` })}
          className="fade-in cursor-grab touch-none rounded-pill border border-subtle bg-raised/90 px-3 py-0.5 text-tertiary shadow-(--shadow-tile) backdrop-blur transition-shadow duration-150 hover:text-primary hover:shadow-(--shadow-glow) active:cursor-grabbing"
          onPointerDown={beginDrag}
          onClick={() => {
            // A drag that began here also ends in a click; only a real one
            // reopens the toolbar. Keyboard activation fires no pointer
            // events, so the flag is false and Enter/Space still work.
            if (!draggedRef.current) show();
          }}
        >
          <IconChevronDown size={14} className={menuBelow ? "" : "rotate-180"} />
        </button>
        {capturing ? <CaptureIndicator compact /> : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} style={style}>
      <div
        role="toolbar"
        aria-label={t("session.controls")}
        onPointerEnter={() => {
          hovering.current = true;
          window.clearTimeout(idleTimer.current);
        }}
        onPointerLeave={() => {
          hovering.current = false;
          armIdle();
        }}
        /*
         * One row that yields, rather than a bar that wraps.
         *
         * The bar is a single flex row of two dozen controls and is
         * `position: fixed`, so nothing about the layout stops it growing
         * straight past the side of its pane and then past the side of the
         * window, taking the controls at that end out of reach. Clamping the
         * corner keeps the left of it on screen, which is not the same as
         * keeping all of it on screen; wrapping kept the whole bar in view by
         * laying it across the very desktop it floats on. Given a width to
         * work within it now folds its weakest groups into the overflow menu
         * instead (`lib/toolbarLayout` decides which), and `overflow-hidden`
         * is the belt to that braces: the budget errs toward fitting, so the
         * clip should never be visible, but a frame spent mid-resize should
         * clip rather than spill across the pane.
         */
        style={{ maxWidth: maxBarWidth }}
        className="fade-in flex flex-nowrap items-center justify-center gap-0.5 overflow-hidden rounded-lg border border-subtle bg-raised/95 px-1.5 py-1 shadow-(--shadow-pop) backdrop-blur transition-shadow duration-150 hover:shadow-(--shadow-glow)"
      >
        {/*
          Each group is one span of adjacent buttons, matching the runs the
          dividers already cut the bar into. A folded group unmounts whole,
          so it leaves nothing behind but its entry in the overflow menu; the
          groups that never fold are the ones a person reaches for without
          looking — the front of the bar, quality, keyboard, and disconnect.
        */}
        <span ref={setGroupEl("quick")} className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={t("session.dragToolbar")}
            className="cursor-grab px-0.5 text-tertiary active:cursor-grabbing"
            onPointerDown={beginDrag}
          >
            <IconGripVertical size={14} />
          </button>

          {/*
            The two things a person does in the first minute of a session, first.

            Fullscreen was the twelfth control and Ctrl+Alt+Del was two menus
            deep, which meant the two most common requests were the two hardest
            to find. They are here now, at the front, with the rest of the bar
            unchanged behind them.
          */}
          <ToolButton label={t("session.fullscreen", { hint: fullscreenHint })} onClick={props.onFullscreen}>
            <IconMaximize size={15} />
          </ToolButton>

          <ToolButton
            label={t("session.sendCtrlAltDel", { combo: "Ctrl+Alt+Del" })}
            onClick={() => props.onSendCombo("ctrl-alt-del")}
          >
            <IconCommand size={15} />
          </ToolButton>

          <Divider />
        </span>

        {/*
          The latency readout yields before the controls do: it only reports,
          and the same figures live in Session ▸ Connection Info, which
          needs no toolbar to be reached.
        */}
        {collapsedGroups.has("status") ? null : (
          <span ref={setGroupEl("status")} className="flex shrink-0 items-center gap-0.5">
            <ToolButton
              label={t("session.connectionStatus")}
              active={openMenu === "status"}
              onClick={() => setOpenMenu(openMenu === "status" ? null : "status")}
            >
              <span className={`h-2 w-2 rounded-full ${latencyColor}`} />
              {/* Fixed width, right-aligned: the figure changes every second, and
                  letting it size itself made the whole toolbar twitch sideways as
                  the reading moved between "-", "9ms" and "290ms". */}
              <span className="inline-block w-[5ch] text-end text-xs tabular-nums text-secondary">
                {latency !== null ? `${Math.round(latency)}ms` : "-"}
              </span>
            </ToolButton>

            <Divider />
          </span>
        )}

        {collapsedGroups.has("view") ? null : (
          <span ref={setGroupEl("view")} className="flex shrink-0 items-center gap-0.5">
            <ToolButton label={t("host.scaling")} active={openMenu === "scale"} onClick={() => setOpenMenu(openMenu === "scale" ? null : "scale")}>
              <IconSearch size={15} />
              <span className="text-xs text-secondary">
                {props.scalingMode === "custom" ? `${Math.round(props.zoom * 100)}%` : scaleLabel(props.scalingMode, t)}
              </span>
            </ToolButton>

            <ToolButton label={t("session.displays")} active={openMenu === "displays"} onClick={() => setOpenMenu(openMenu === "displays" ? null : "displays")}>
              <IconMonitor size={15} />
              {props.displayId !== null ? (
                <span className="text-xs text-secondary">
                  {props.screens.findIndex((s) => s.id === props.displayId) + 1}/{props.screens.length}
                </span>
              ) : null}
            </ToolButton>

            <ToolButton
              label={t("session.pointers")}
              active={openMenu === "pointer"}
              onClick={() => setOpenMenu(openMenu === "pointer" ? null : "pointer")}
            >
              <IconCursor size={15} />
            </ToolButton>
          </span>
        )}

        {/*
          Quality and keyboard stay whatever happens: they are the two answers
          to "this session feels wrong" — the picture is slow, or the keyboard
          is not going through — and both report their state on the button.
        */}
        <span ref={setGroupEl("tuning")} className="flex shrink-0 items-center gap-0.5">
          <ToolButton label={t("host.quality")} active={openMenu === "quality"} onClick={() => setOpenMenu(openMenu === "quality" ? null : "quality")}>
            <IconActivity size={15} />
            <span className="text-xs uppercase text-secondary">{qualityBadge(props.quality, t)}</span>
          </ToolButton>

          <ToolButton
            label={captureButtonLabel(props.captureStatus, props.passthrough, t)}
            active={openMenu === "keyboard"}
            toggled={capturing}
            onClick={() => setOpenMenu(openMenu === "keyboard" ? null : "keyboard")}
          >
            <IconKeyboard size={15} />
            {props.passthrough ? (
              <span
                className={classNames(
                  "h-1.5 w-1.5 rounded-full",
                  capturing
                    ? "bg-accent"
                    : props.captureStatus.state === "inactive"
                      ? "bg-tertiary"
                      : "bg-warning",
                )}
              />
            ) : null}
          </ToolButton>

          {capturing ? <CaptureIndicator /> : null}
        </span>

        {collapsedGroups.has("transfer") ? null : (
          <span ref={setGroupEl("transfer")} className="flex shrink-0 items-center gap-0.5">
            <ToolButton label={t("session.sendClipboard")} onClick={props.onClipboardSend}>
              <IconClipboard size={15} />
            </ToolButton>

            <ToolButton
              label={filesLabel}
              disabled={props.filesAvailable !== true}
              onClick={props.onFiles}
            >
              <IconFile size={15} />
            </ToolButton>

            <ToolButton
              label={terminalLabel}
              disabled={props.terminalAvailable !== true}
              onClick={props.onTerminal}
            >
              <IconTerminal size={15} />
            </ToolButton>

            <Divider />
          </span>
        )}

        {/*
          Pane actions fold first: splitting, view-only, a screenshot and a
          refresh are all things a person sets up and then leaves alone, and
          a session in a window of its own has no splits to show anyway.
        */}
        {collapsedGroups.has("pane") ? null : (
          <span ref={setGroupEl("pane")} className="flex shrink-0 items-center gap-0.5">
            {/* Only a session shown in a tab has panes to divide. A window has
                nothing to put a second desktop beside. */}
            {props.onSplit ? (
              <>
                <ToolButton label={splitRightLabel} onClick={() => props.onSplit?.("row")}>
                  <IconSplitRight size={15} />
                </ToolButton>
                <ToolButton label={splitDownLabel} onClick={() => props.onSplit?.("column")}>
                  <IconSplitDown size={15} />
                </ToolButton>
              </>
            ) : null}

            <ToolButton
              label={viewOnlyLabel}
              toggled={props.viewOnly}
              onClick={() => props.onViewOnly(!props.viewOnly)}
            >
              <IconEye size={15} />
            </ToolButton>

            <ToolButton label={t("session.saveScreenshot")} onClick={props.onScreenshot}>
              <IconCamera size={15} />
            </ToolButton>

            <ToolButton label={t("session.requestRefresh")} onClick={props.onRefresh}>
              <IconRefresh size={15} />
            </ToolButton>
          </span>
        )}

        {/*
          The bar's own controls are the last thing to go, and they go
          outright rather than behind the menu: a pane this narrow is a pane
          where every pixel counts, and both actions survive elsewhere — the
          chord Ctrl/Cmd+Shift+M toggles the bar, and Preferences ▸ Session
          and the native View menu put it away too.
        */}
        {collapsedGroups.has("chrome") ? null : (
          <span ref={setGroupEl("chrome")} className="flex shrink-0 items-center gap-0.5">
            <ToolButton
              label={pinned ? t("session.unpin") : t("session.pin")}
              toggled={pinned}
              onClick={() => {
                const v = !pinned;
                setPinned(v);
                storeLayout(PIN_KEY, v ? "1" : "0");
              }}
            >
              <IconPin size={15} />
            </ToolButton>

            {/* Auto-hide only ever arrives on its own schedule, and a pinned
                toolbar never hides at all, so put it away by hand from here.

                This one is the remembered show/hide: the chevron it leaves behind
                is the way back, and the chord does the same thing. It is the only
                control on the bar whose state outlives the session, which is why
                its label says so rather than repeating "collapse". */}
            <ToolButton label={t("session.hideToolbar", { chord: `${modKeyLabel}⇧M` })} onClick={hide}>
              <IconChevronDown size={15} className={menuBelow ? "rotate-180" : ""} />
            </ToolButton>

            <Divider />
          </span>
        )}

        <span ref={setGroupEl("disconnect")} className="flex shrink-0 items-center gap-0.5">
          <ToolButton
            label={t("session.disconnect")}
            danger
            onClick={props.onDisconnect}
          >
            <IconDisconnect size={15} />
          </ToolButton>
        </span>

        {/*
          The one control that stands in for folded groups, and only exists
          while some group is folded. Its label is the catalogue's, so it
          reads the same as every other control's tooltip.
        */}
        {overflowGroups.length > 0 ? (
          <ToolButton
            label={t("session.more")}
            active={openMenu === "more"}
            onClick={() => setOpenMenu(openMenu === "more" ? null : "more")}
          >
            <IconMore size={15} />
            <span className="text-xs text-secondary">{t("session.more")}</span>
          </ToolButton>
        ) : null}
      </div>

      {/* menus */}
      {openMenu ? (
        <div
          className={classNames(
            "absolute left-1/2 min-w-52 -translate-x-1/2 rounded-md border border-subtle bg-raised p-1.5 shadow-(--shadow-pop)",
            menuBelow ? "top-full mt-2" : "bottom-full mb-2",
          )}
          role="menu"
        >
          {openMenu === "status" ? (
            <div className="w-60 px-2.5 py-1.5">
              <SessionStatusDetails stats={props.stats} queueStats={props.queueStats} desktopName={props.desktopName} />
            </div>
          ) : null}
          {openMenu === "scale" ? (
            <div>
              {(["fit", "aspect-fit", "actual"] as ScalingMode[]).map((m) => (
                <MenuRow key={m} selected={props.scalingMode === m} onClick={() => props.onScalingMode(m)}>
                  {scaleLabel(m, t)}
                </MenuRow>
              ))}
              <MenuRow selected={props.scalingMode === "custom"} onClick={() => props.onScalingMode("custom")}>
                {t("session.customZoom")}
              </MenuRow>
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <input
                  type="range"
                  min={25}
                  max={400}
                  step={5}
                  value={Math.round(props.zoom * 100)}
                  aria-label={t("session.zoomPercent")}
                  className="flex-1 accent-(--accent)"
                  onChange={(e) => props.onZoom(parseInt(e.target.value, 10) / 100)}
                />
                <span className="w-11 text-end text-xs tabular-nums text-secondary">
                  {Math.round(props.zoom * 100)}%
                </span>
              </div>
              {/*
                This was disabled for RDP with a note saying the Display Update
                channel was not spoken yet. It is: MS-RDPEDISP has been
                implemented and tested for a while, and the native View menu
                never gated the same row, so the two disagreed.
              */}
              <MenuRow
                selected={props.scalingMode === "remote-resize"}
                onClick={() => props.onScalingMode("remote-resize")}
              >
                {t("session.remoteResize")}
              </MenuRow>
              {props.protocol === "rdp" ? (
                <p className="px-2.5 pb-1 text-2xs text-tertiary">
                  {t("session.rdpFixedSize")}
                </p>
              ) : null}
              <MenuRow
                selected={props.zoomLocked}
                onClick={() => props.onZoomLocked(!props.zoomLocked)}
              >
                {t("session.lockZoom")}
              </MenuRow>
              <MenuRow selected={props.edgePan} onClick={() => props.onEdgePan(!props.edgePan)}>
                {t("session.panByEdges")}
              </MenuRow>
            </div>
          ) : null}
          {openMenu === "pointer" ? (
            <div>
              <p className="px-2.5 pt-1.5 pb-1 text-2xs uppercase tracking-wide text-tertiary">
                {t("session.remotePointer")}
              </p>
              <MenuRow
                selected={props.showRemoteCursor}
                onClick={() => props.onShowRemoteCursor(!props.showRemoteCursor)}
              >
                {t("session.showRemotePointer")}
              </MenuRow>
              <p className="px-2.5 pt-2 pb-1 text-2xs uppercase tracking-wide text-tertiary">
                {t("session.myPointer")}
              </p>
              {(["standard", "dot", "off"] as LocalCursor[]).map((mode) => (
                <MenuRow
                  key={mode}
                  selected={props.localCursor === mode}
                  onClick={() => props.onLocalCursor(mode)}
                >
                  {cursorLabel(mode, t)}
                </MenuRow>
              ))}
            </div>
          ) : null}
          {openMenu === "displays" ? (
            <div>
              <MenuRow selected={props.displayId === null} onClick={() => props.onDisplay(null)}>
                {t("session.allDisplays")}
              </MenuRow>
              {!props.layoutKnown && props.screens.length > 0 ? (
                <p className="px-2.5 pt-2 pb-1 text-2xs uppercase tracking-wide text-tertiary">
                  {t("session.splitThisDesktop")}
                </p>
              ) : null}
              {props.screens.map((s, i) => (
                <MenuRow
                  key={s.id}
                  selected={props.displayId === s.id}
                  onClick={() => props.onDisplay(s.id)}
                >
                  {s.label ?? t("session.displayRow", { n: i + 1, w: s.width, h: s.height })}
                </MenuRow>
              ))}
              {/*
                A Remote Desktop session without multiple monitors negotiated
                is genuinely one display, not a wide framebuffer with monitors
                hidden inside it, so cutting it in half by width would be
                inventing monitors. The line that replaces the detector points
                at the setting that fills this menu instead of leaving it
                empty.
              */}
              {!props.layoutKnown && props.protocol === "rdp" ? (
                <p className="px-2.5 py-1 text-2xs text-tertiary">
                  {t("session.singleDisplay")}
                </p>
              ) : !props.layoutKnown ? (
                <>
                  <MenuRow onClick={props.onDetectDisplays}>{t("session.detectDisplays")}</MenuRow>
                  <p className="px-2.5 py-1 text-2xs text-tertiary">
                    {props.screens.length > 0
                      ? t("session.displaysUnknown")
                      : t("session.displaysUndescribed")}
                  </p>
                </>
              ) : null}
            </div>
          ) : null}
          {openMenu === "quality" ? (
            <div>
              {/*
                One list, named for the trade the person is actually making.
                These used to be split into a "Network" list (Auto / LAN / WAN)
                and a "Quality" list (Auto / High / Medium / Low / B&W) that
                called the same setter with the same five values, so the same
                choice appeared twice under two different vocabularies and
                neither said what it costs you. They are named for the trade
                now: picture sharpness against how quickly the screen answers
                you.

                Auto is the honest default and does both. It keeps the picture
                sharp while the client can afford it, and steps down while the
                client is genuinely saturated (measured as the fraction of each
                second spent handling updates), then comes back up. A video
                playing on the remote is the case that needs it: measured on a
                real one, the menu you right-click for went from 2208 ms to
                346 ms because Auto dropped the quality on its own.
              */}
              <p className="px-2.5 py-1 text-2xs text-tertiary">{t("session.pictureVsResponse")}</p>
              <MenuRow selected={props.quality === "auto"} onClick={() => props.onQuality("auto")}>
                {t("session.qualityAuto")}
              </MenuRow>
              <MenuRow selected={props.quality === "high"} onClick={() => props.onQuality("high")}>
                {t("session.qualitySharp")}
              </MenuRow>
              <MenuRow selected={props.quality === "medium"} onClick={() => props.onQuality("medium")}>
                {t("host.qualityBalanced")}
              </MenuRow>
              <MenuRow selected={props.quality === "low"} onClick={() => props.onQuality("low")}>
                {t("session.qualityResponsive")}
              </MenuRow>
              <MenuRow selected={props.quality === "bw"} onClick={() => props.onQuality("bw")}>
                {t("host.qualityBw")}
              </MenuRow>
              {/*
                Hidden for RDP rather than disabled, and that asymmetry with
                "Remote resize" above is deliberate. This switch exists for a
                failure that is specific to RFB: the client asks for an
                incremental update and gets back whatever the server thinks
                changed, so a server whose damage tracking cannot be trusted
                leaves a stale picture that a poll fixes. Remote Desktop
                pushes its own updates with its own ordering, so there is no
                equivalent state to poll out of. A switch that costs the whole
                desktop in bandwidth every second and fixes nothing is worse
                than no switch, and "disabled with a reason" would still be
                claiming the problem exists.
              */}
              {props.protocol === "rdp" ? null : (
                <div className="mt-1 border-t border-subtle pt-1">
                  <MenuRow
                    selected={props.alwaysRefresh}
                    onClick={() => props.onAlwaysRefresh(!props.alwaysRefresh)}
                  >
                    {t("session.alwaysFresh")}
                  </MenuRow>
                  <p className="px-2.5 pb-1 text-2xs text-tertiary">
                    {t("session.alwaysFreshHint")}
                  </p>
                </div>
              )}
              {props.quality === "bw" ? (
                <div className="mt-1 border-t border-subtle pt-1">
                  <p className="px-2.5 py-1 text-2xs text-tertiary">{t("session.grayLevels")}</p>
                  {[256, 16, 8, 4, 2, 1].map((n) => (
                    <MenuRow key={n} selected={props.bwLevels === n} onClick={() => props.onBwLevels(n)}>
                      {n === 1 ? t("session.oneBit") : t("session.levels", { n })}
                    </MenuRow>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {openMenu === "keyboard" ? (
            <div>
              <MenuRow selected={props.passthrough} onClick={() => props.onPassthrough(!props.passthrough)}>
                {t("session.passShortcuts")}
              </MenuRow>
              <CaptureStatusNote
                status={props.captureStatus}
                passthrough={props.passthrough}
                onPermission={props.onCapturePermission}
              />
              <div className="mt-1 border-t border-subtle pt-1">
                <p className="px-2.5 py-1 text-2xs text-tertiary">{t("session.sendToRemote")}</p>
                <MenuRow onClick={() => props.onSendCombo("ctrl-alt-del")}>Ctrl+Alt+Del</MenuRow>
                <MenuRow onClick={() => props.onSendCombo("cmd-tab")}>Cmd/Alt+Tab</MenuRow>
                <MenuRow onClick={() => props.onSendCombo("win")}>{t("session.keyWindows")}</MenuRow>
                <MenuRow onClick={() => props.onSendCombo("alt-f4")}>Alt+F4</MenuRow>
                <MenuRow onClick={() => props.onSendCombo("escape")}>Escape</MenuRow>
              </div>
            </div>
          ) : null}
          {/*
            What folded away, offered back.

            The rows are the same buttons with the same labels running the
            same handlers, in the order they sit on the bar. A dropdown of
            rows is how this bar already offers everything else, so the
            overflow is that menu again rather than a second kind of popup:
            the rows that open a group's own menu switch to it in place, and
            the rows that are actions close this one as they run.
          */}
          {openMenu === "more" ? (
            <div>
              {collapsedGroups.has("view") ? (
                <div>
                  <MenuRow onClick={() => setOpenMenu("scale")}>{t("host.scaling")}</MenuRow>
                  <MenuRow onClick={() => setOpenMenu("displays")}>{t("session.displays")}</MenuRow>
                  <MenuRow onClick={() => setOpenMenu("pointer")}>{t("session.pointers")}</MenuRow>
                </div>
              ) : null}
              {collapsedGroups.has("transfer") ? (
                <div>
                  <MenuRow
                    onClick={() => {
                      setOpenMenu(null);
                      props.onClipboardSend();
                    }}
                  >
                    {t("session.sendClipboard")}
                  </MenuRow>
                  <MenuRow
                    disabled={props.filesAvailable !== true}
                    onClick={() => {
                      setOpenMenu(null);
                      props.onFiles();
                    }}
                  >
                    {filesLabel}
                  </MenuRow>
                  <MenuRow
                    disabled={props.terminalAvailable !== true}
                    onClick={() => {
                      setOpenMenu(null);
                      props.onTerminal();
                    }}
                  >
                    {terminalLabel}
                  </MenuRow>
                </div>
              ) : null}
              {collapsedGroups.has("pane") ? (
                <div>
                  {props.onSplit ? (
                    <>
                      <MenuRow
                        onClick={() => {
                          setOpenMenu(null);
                          props.onSplit?.("row");
                        }}
                      >
                        {splitRightLabel}
                      </MenuRow>
                      <MenuRow
                        onClick={() => {
                          setOpenMenu(null);
                          props.onSplit?.("column");
                        }}
                      >
                        {splitDownLabel}
                      </MenuRow>
                    </>
                  ) : null}
                  <MenuRow
                    selected={props.viewOnly}
                    onClick={() => {
                      setOpenMenu(null);
                      props.onViewOnly(!props.viewOnly);
                    }}
                  >
                    {viewOnlyLabel}
                  </MenuRow>
                  <MenuRow
                    onClick={() => {
                      setOpenMenu(null);
                      props.onScreenshot();
                    }}
                  >
                    {t("session.saveScreenshot")}
                  </MenuRow>
                  <MenuRow
                    onClick={() => {
                      setOpenMenu(null);
                      props.onRefresh();
                    }}
                  >
                    {t("session.requestRefresh")}
                  </MenuRow>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------- capture indicator

/**
 * "Your keyboard is grabbed" badge.
 *
 * PRD/06 §3 makes this non-negotiable: a stuck grab that swallows the
 * keyboard is unforgivable, so whenever native capture is live the user can
 * see it *and* is told the release chord, even when the toolbar is collapsed.
 */
function CaptureIndicator({ compact }: { compact?: boolean }): ReactNode {
  const t = useT();
  const label = t("session.captureBadge", { chord: RELEASE_CHORD });
  return (
    <span
      role="status"
      aria-live="polite"
      title={label}
      aria-label={label}
      className={classNames(
        "flex items-center gap-1.5 rounded-pill bg-accent/15 text-accent",
        compact
          ? "border border-subtle bg-raised/90 px-2 py-1 shadow-(--shadow-tile) backdrop-blur"
          : "ms-0.5 px-2 py-1",
      )}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden="true" />
      <IconKeyboard size={14} />
      {compact ? null : <span className="text-2xs font-medium uppercase tracking-wide">{t("session.captured")}</span>}
    </span>
  );
}

function captureButtonLabel(status: CaptureStatus, passthrough: boolean, t: Translate): string {
  switch (status.state) {
    case "active":
      return t("session.keyboardCaptured", { chord: RELEASE_CHORD });
    case "permission-required":
      return t("session.keyboardNeedsPermission");
    case "unsupported":
      return t("session.keyboardUnavailable", { reason: status.reason });
    default:
      return passthrough ? t("session.keyboardWaitingFocus") : t("session.keyboard");
  }
}

/**
 * The explanatory line under the pass-through toggle. Every non-active state
 * gets a plain-language reason and, where one exists, a way forward, never a
 * silently dead switch.
 */
function CaptureStatusNote({
  status,
  passthrough,
  onPermission,
}: {
  status: CaptureStatus;
  passthrough: boolean;
  onPermission: () => void;
}): ReactNode {
  const t = useT();
  if (status.state === "active") {
    return (
      <p className="px-2.5 pb-1 text-2xs text-accent">
        {t("session.capturedNote", { chord: RELEASE_CHORD })}
      </p>
    );
  }
  if (status.state === "permission-required") {
    return (
      <div className="px-2.5 pb-1.5">
        <p className="text-2xs text-warning">
          {t("session.needsAccessibility")}
        </p>
        <button
          type="button"
          className="mt-1 text-2xs font-medium text-accent underline underline-offset-2"
          onClick={onPermission}
        >
          {t("session.howToEnable")}
        </button>
      </div>
    );
  }
  if (status.state === "unsupported") {
    return <p className="px-2.5 pb-1 text-2xs text-warning">{status.reason}</p>;
  }
  if (passthrough) {
    return (
      <p className="px-2.5 pb-1 text-2xs text-tertiary">
        {t("session.activeWhileFocused")}
      </p>
    );
  }
  return (
    <p className="px-2.5 pb-1 text-2xs text-tertiary">
      {isMac ? t("session.sendsShortcutsMac") : t("session.sendsShortcuts")}
    </p>
  );
}

function scaleLabel(m: ScalingMode, t: Translate): string {
  switch (m) {
    case "fit":
      return t("host.scalingFit");
    case "aspect-fit":
      return t("host.scalingAspectFit");
    case "actual":
      // A pixel-for-pixel ratio, not a word: the same in every language.
      return "1:1";
    case "remote-resize":
      return t("host.scalingRemoteResize");
    default:
      return t("session.zoom");
  }
}

/**
 * The quality preset, named in the catalogue.
 *
 * The raw preset names are English words ("auto", "high"), so the badge shows
 * the catalogue's names for them instead.
 */
function qualityBadge(quality: QualityPreset, t: Translate): string {
  switch (quality) {
    case "auto":
      return t("host.auto");
    case "high":
      return t("host.qualitySharp");
    case "medium":
      return t("host.qualityBalanced");
    case "low":
      return t("host.qualityResponsive");
    default:
      return t("host.qualityBw");
  }
}

/** The shape of the local pointer, named in the catalogue. */
function cursorLabel(mode: LocalCursor, t: Translate): string {
  switch (mode) {
    case "standard":
      return t("session.cursorStandard");
    case "dot":
      return t("session.cursorDot");
    default:
      return t("session.cursorHidden");
  }
}

function ToolButton({
  label,
  onClick,
  children,
  active,
  toggled,
  danger,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  toggled?: boolean;
  danger?: boolean;
  disabled?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      aria-pressed={toggled}
      className={classNames(
        "flex items-center gap-1 rounded-pill px-2 py-1.5",
        disabled
          ? "cursor-default text-tertiary/50"
          : danger
            ? "text-danger hover:bg-danger-subtle"
            : active || toggled
              ? "bg-accent/15 text-accent"
              : "text-secondary hover:bg-inset hover:text-primary",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider(): ReactNode {
  return <span className="mx-0.5 h-4 w-px bg-(--border-subtle)" aria-hidden="true" />;
}

function MenuRow({
  children,
  onClick,
  selected,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  selected?: boolean;
  disabled?: boolean;
}): ReactNode {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      disabled={disabled}
      className={classNames(
        "flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-start text-sm",
        disabled
          ? "cursor-default text-tertiary/60"
          : selected
            ? "font-medium text-accent"
            : "text-primary hover:bg-inset",
      )}
      onClick={onClick}
    >
      <span className="w-3 text-accent">{selected ? "✓" : ""}</span>
      {children}
    </button>
  );
}

/**
 * What the connection is doing. Exported because Session ▸ Connection Info
 * shows the same figures in a dialog: with the toolbar hidden there is no
 * status button to open, and the latency reading is the first thing anyone
 * looks for when a session feels slow.
 */
export function SessionStatusDetails({
  stats,
  queueStats,
  desktopName,
}: {
  stats: SessionStats | null;
  queueStats?: { depth: number; bytes: number; droppedRects: number; droppedUpdates: number } | null;
  desktopName: string;
}): ReactNode {
  const t = useT();
  return (
    <div className="text-sm">
      <p className="mb-2 truncate font-medium text-primary">{desktopName}</p>
      {stats ? (
        <dl className="grid grid-cols-2 gap-y-1 text-xs">
          <dt className="text-tertiary">{t("session.latency")}</dt>
          <dd className="tabular-nums text-primary">
            {stats.rtt_ms > 0 ? `${Math.round(stats.rtt_ms)} ms` : "-"}
          </dd>
          <dt className="text-tertiary">{t("session.throughput")}</dt>
          <dd className="tabular-nums text-primary">{formatBps(stats.throughput_bps)}</dd>
          <dt className="text-tertiary">{t("session.frameRate")}</dt>
          <dd className="tabular-nums text-primary">{stats.fps.toFixed(0)} fps</dd>
          <dt className="text-tertiary">{t("session.decode")}</dt>
          <dd className="tabular-nums text-primary">{stats.decode_ms.toFixed(1)} ms</dd>
          <dt className="text-tertiary">{t("session.encoding")}</dt>
          <dd className="mono text-primary">{encodingName(stats.current_encoding)}</dd>
          <dt className="text-tertiary">{t("session.received")}</dt>
          <dd className="tabular-nums text-primary">{(stats.bytes_received / 1e6).toFixed(1)} MB</dd>
          {/*
            The renderer's own queue, and what it has shed.

            It was invisible until now: the counters existed and nothing ever
            read them, so "the picture is behind" could not be told apart from
            "the picture is behind because the client is throwing frames
            away". A person reporting a slow session can now see which it is,
            and so can whoever reads the report.
          */}
          {queueStats && queueStats.droppedRects + queueStats.droppedUpdates > 0 ? (
            <>
              <dt className="text-tertiary">{t("session.shed")}</dt>
              <dd className="tabular-nums text-warning">
                {t("session.shedCounts", {
                  rects: queueStats.droppedRects,
                  updates: queueStats.droppedUpdates,
                })}
              </dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="text-xs text-tertiary">{t("session.statsLater")}</p>
      )}
    </div>
  );
}

function encodingName(enc: number): string {
  switch (enc) {
    case 0: return "Raw";
    case 1: return "CopyRect";
    case 2: return "RRE";
    case 5: return "Hextile";
    case 7: return "Tight";
    case 16: return "ZRLE";
    case 50: return "H.264";
    default: return `#${enc}`;
  }
}
