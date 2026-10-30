/**
 * Arrow-key navigation inside a radio group.
 *
 * A group that only looks like a radio group still tells a screen reader "radio
 * group, one of three", and then the arrow keys do nothing. This is the one
 * piece of that contract worth testing on its own: which option a key reaches,
 * including the wrap and the fact that Left/Right follow the reading direction
 * rather than the physical layout.
 */
export type TextDirection = "ltr" | "rtl";

/**
 * The index an arrow key moves to, or null when the key is not one of the
 * four this group answers. Wraps at both ends, as the radios pattern says.
 */
export function radioMove(
  key: string,
  index: number,
  count: number,
  direction: TextDirection,
): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "ArrowRight":
      // In a right-to-left interface the next option is to the LEFT, and the
      // arrow that walks forward is the one pointing the same way the text
      // runs. Swapping them here keeps every group consistent with the page.
      return direction === "rtl" ? (index - 1 + count) % count : (index + 1) % count;
    case "ArrowLeft":
      return direction === "rtl" ? (index + 1) % count : (index - 1 + count) % count;
    default:
      return null;
  }
}
