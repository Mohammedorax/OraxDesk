/**
 * One visibility watcher for many elements, each woken exactly once.
 *
 * The Library grid renders every tile it has, and a tile's picture is a file
 * on disk: asking for all of them the moment the window opened meant a
 * fifty-host library read fifty PNGs for pictures nobody had looked at yet.
 * One `IntersectionObserver` watching every tile instead wakes a tile when it
 * comes into view, and never again.
 *
 * The observer is injected rather than constructed here so this bookkeeping —
 * which element is waiting for what, one hit per watch, no watch left
 * dangling — is testable without a DOM that implements `IntersectionObserver`
 * (jsdom does not).
 */

/** The half of `IntersectionObserver` this module drives. */
export interface ObserveHandle {
  observe(target: Element): void;
  unobserve(target: Element): void;
}

export interface VisibleOnce {
  /**
   * Call `onVisible` the next time `el` intersects, then stop watching it.
   *
   * Returns the detach function. Detaching before that hit cancels it;
   * detaching after it is a no-op.
   */
  watch(el: Element, onVisible: () => void): () => void;
}

export function createVisibleOnce(
  createObserver: (hit: (target: Element) => void) => ObserveHandle,
): VisibleOnce {
  const waiting = new Map<Element, () => void>();
  const observer = createObserver((target) => {
    const onVisible = waiting.get(target);
    if (!onVisible) return; // already consumed, or detached since
    waiting.delete(target);
    observer.unobserve(target);
    onVisible();
  });
  return {
    watch(el, onVisible) {
      waiting.set(el, onVisible);
      observer.observe(el);
      return () => {
        // Only the owner of the CURRENT registration cancels it: a detach
        // that lost a re-watch race must not unwatch the watch that replaced
        // it, or that tile would sleep until something else scrolled.
        if (waiting.get(el) === onVisible) {
          waiting.delete(el);
          observer.unobserve(el);
        }
      };
    },
  };
}
