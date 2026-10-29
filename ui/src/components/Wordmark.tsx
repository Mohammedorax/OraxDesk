/**
 * The OraxDesk wordmark, in the brand typeface and the brand colours.
 *
 * Text rather than the identity pack's PNG: the pack's horizontal logo is a
 * preview crop with its own background baked in, and it would not sit on this
 * window's surface in either theme. The wordmark here is the same three parts
 * the logotype is — "Ora", the red X, and "Desk" in blue — set in Tajarib, so
 * it scales with the text around it and stays sharp.
 *
 * The text is not hidden from assistive technology: the three spans read as
 * one word, "OraxDesk", and there is nothing extra to announce.
 */
import type { ReactNode } from "react";
import { classNames } from "../lib/util";

export function Wordmark({ className }: { className?: string }): ReactNode {
  return (
    <span className={classNames("brand-wordmark", className)}>
      Ora<span className="brand-x">x</span>
      <span className="brand-desk">Desk</span>
    </span>
  );
}
