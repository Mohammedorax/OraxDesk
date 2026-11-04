"use client";

import { useEffect, useRef } from "react";

/**
 * Light, elegant cursor companion:
 * - a crisp dot that tracks the pointer exactly;
 * - a soft ring that follows with a gentle lag and expands over links/buttons.
 * Only activates for fine pointers (mouse), never on touch,
 * and stays still for users who prefer reduced motion.
 */
export function CursorFollower() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    /* Touch devices stay dormant; fine pointers (and environments without
       pointer media support) arm on the first real mouse movement. */
    const likelyTouch =
      navigator.maxTouchPoints > 0 &&
      !window.matchMedia("(pointer: fine)").matches &&
      !window.matchMedia("(hover: hover)").matches;
    if (reducedMotion || likelyTouch) return;

    const dot = dotRef.current;
    const ring = ringRef.current;
    if (!dot || !ring) return;

    let mouseX = -100;
    let mouseY = -100;
    let ringX = -100;
    let ringY = -100;
    let scale = 1;
    let targetScale = 1;
    let raf = 0;
    let shown = false;

    const show = () => {
      if (!shown) {
        shown = true;
        dot.style.opacity = "1";
        ring.style.opacity = "1";
        ringX = mouseX;
        ringY = mouseY;
      }
    };

    const hide = () => {
      shown = false;
      dot.style.opacity = "0";
      ring.style.opacity = "0";
    };

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      show();
      const target = e.target as HTMLElement | null;
      targetScale =
        target && target.closest("a, button, [role='button'], input, textarea, select")
          ? 1.75
          : 1;
    };

    const loop = () => {
      /* Exact dot */
      dot.style.transform = `translate3d(${mouseX - 3}px, ${mouseY - 3}px, 0)`;
      /* Lagging ring */
      ringX += (mouseX - ringX) * 0.16;
      ringY += (mouseY - ringY) * 0.16;
      scale += (targetScale - scale) * 0.14;
      ring.style.transform = `translate3d(${ringX - 17}px, ${ringY - 17}px, 0) scale(${scale.toFixed(3)})`;
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", hide);
    raf = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      document.documentElement.removeEventListener("mouseleave", hide);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <div
        ref={ringRef}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[60] size-[34px] rounded-full border border-ink/25 opacity-0 transition-opacity duration-300"
      />
      <div
        ref={dotRef}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[60] size-1.5 rounded-full bg-ink/50 opacity-0 transition-opacity duration-300"
      />
    </>
  );
}
