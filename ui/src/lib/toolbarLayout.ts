/**
 * Which groups of the session toolbar fold away, and in what order, when the
 * pane is narrower than the bar's buttons.
 *
 * The bar is one row of adjacent groups (SessionToolbar says where each
 * group's buttons sit). Left alone it would either wrap over the very desktop
 * it is meant to float on or run past the edge of its pane, so when room runs
 * out the weakest group folds first: its buttons move behind one overflow
 * menu, then the next. Two groups carry no menu entries — the latency
 * readout, and the bar's own pin/put-away pair — because a readout has no
 * action to perform and the pin has a chord and a menu elsewhere; those are
 * simply left off at the extreme. What stays whatever happens is the front of
 * the bar, quality, keyboard and disconnect: the controls a person reaches
 * for without looking.
 *
 * The rule lives here rather than in the component because it is arithmetic
 * on measured widths, and arithmetic is what a test can hold still.
 */

/**
 * Every group of the bar, in the order they sit on it.
 *
 * `quick` is the grip and the two first-minute actions; `tuning` is quality
 * plus the keyboard-capture control, the two answers to "this session feels
 * wrong"; `chrome` is the bar's own pin and put-away pair.
 */
export const TOOLBAR_GROUPS = [
  "quick",
  "status",
  "view",
  "tuning",
  "transfer",
  "pane",
  "chrome",
  "disconnect",
] as const;

export type ToolbarGroupId = (typeof TOOLBAR_GROUPS)[number];

/**
 * The groups that may fold, weakest first: each is folded before the one
 * after it, so a bar that is only a little too narrow loses one group and a
 * bar that is far too narrow loses them all.
 */
export const TOOLBAR_COLLAPSE_ORDER = [
  "pane",
  "transfer",
  "view",
  "status",
  "chrome",
] as const satisfies readonly ToolbarGroupId[];

/**
 * Of those, the groups whose buttons get an entry in the overflow menu.
 * Listed in bar order, so the menu reads the way the bar would have.
 */
export const TOOLBAR_MENU_GROUPS = ["view", "transfer", "pane"] as const satisfies readonly ToolbarGroupId[];

/**
 * What one group costs beyond its own buttons: the gap the bar puts between
 * neighbours, rounded up. Counting a little more than the real gap makes the
 * budget err toward folding rather than toward a bar a few pixels too wide.
 */
const GROUP_GAP_PX = 4;

/**
 * What the overflow control costs, padded.
 *
 * It carries a label, and the two catalogues label it by different lengths,
 * so it is budgeted at the wider of the two plus room to spare.
 * Overestimating can only fold one group sooner than strictly necessary;
 * underestimating would let the bar exceed the pane, which is the very thing
 * this exists to prevent.
 */
export const OVERFLOW_BUTTON_PX = 96;

/**
 * The groups to fold so the bar fits in `room` pixels.
 *
 * `room` is the width between the pill's own edges, already clear of its
 * padding and border. `widths` holds each group's last measured width; a
 * group with no width recorded (or a width that is not a positive number)
 * contributes nothing and is never folded, so a bar that has just rendered
 * and not measured yet keeps everything on rather than folding buttons
 * nobody has seen. Once every group has a real width, the returned set is
 * exactly the weakest prefix of `TOOLBAR_COLLAPSE_ORDER` that makes the bar
 * fit, with the overflow control's own width charged from the first fold.
 */
export function collapseToolbarGroups(
  widths: Readonly<Partial<Record<ToolbarGroupId, number>>>,
  room: number,
): Set<ToolbarGroupId> {
  const width = (id: ToolbarGroupId): number => {
    const w = widths[id];
    return typeof w === "number" && Number.isFinite(w) && w > 0 ? w : 0;
  };

  let total = 0;
  for (const id of TOOLBAR_GROUPS) total += width(id) + GROUP_GAP_PX;

  const collapsed = new Set<ToolbarGroupId>();
  if (total <= room) return collapsed;

  for (const id of TOOLBAR_COLLAPSE_ORDER) {
    const w = width(id);
    // A group with nothing on it (or nothing measured yet) gives nothing
    // back by folding, and the overflow control it would summon costs more
    // than the gap it saves, so it is skipped rather than folded.
    if (w === 0) continue;
    total -= w + GROUP_GAP_PX;
    if (collapsed.size === 0) total += OVERFLOW_BUTTON_PX;
    collapsed.add(id);
    if (total <= room) break;
  }
  return collapsed;
}
