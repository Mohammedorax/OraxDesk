/**
 * Keeping the toast stack to its cap without throwing away the one button
 * somebody may have seconds left to press.
 *
 * The shelf is three deep. A burst of "copied" toasts must not push a delete
 * confirmation with its only Undo off the bottom: an Undo that disappears
 * before it can be reached is the same as no Undo at all. So a toast with an
 * action is the last thing evicted, and only when every toast in the stack has
 * one does the oldest go.
 */
export function trimToastStack<T extends { actionLabel?: string }>(
  toasts: readonly T[],
  max: number,
): T[] {
  const kept = [...toasts];
  while (kept.length > max) {
    const plain = kept.findIndex((toast) => toast.actionLabel === undefined);
    kept.splice(plain === -1 ? 0 : plain, 1);
  }
  return kept;
}
