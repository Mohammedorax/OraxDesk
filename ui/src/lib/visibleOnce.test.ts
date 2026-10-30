import { describe, expect, it, vi } from "vitest";
import { createVisibleOnce, type ObserveHandle } from "./visibleOnce";

/**
 * A stand-in for `IntersectionObserver`: it records who is watched and lets
 * the test deliver the hit itself, which is the only thing the real one
 * contributes that this module cares about.
 */
function fakeObserver(): {
  create: (hit: (target: Element) => void) => ObserveHandle;
  watched: Element[];
  unwatched: Element[];
  hit(target: Element): void;
} {
  const watched: Element[] = [];
  const unwatched: Element[] = [];
  let notify: ((target: Element) => void) | null = null;
  return {
    create(hit) {
      notify = hit;
      return {
        observe: (t) => {
          watched.push(t);
        },
        unobserve: (t) => {
          unwatched.push(t);
        },
      };
    },
    watched,
    unwatched,
    hit(target) {
      notify?.(target);
    },
  };
}

/** An element stand-in: this module only ever uses elements as keys. */
function el(id: string): Element {
  return { id } as Element;
}

describe("createVisibleOnce", () => {
  it("wakes a watcher when its element intersects, exactly once", () => {
    const fake = fakeObserver();
    const once = createVisibleOnce(fake.create);
    const tile = el("a");
    const onVisible = vi.fn();
    once.watch(tile, onVisible);

    expect(fake.watched).toEqual([tile]);
    fake.hit(tile);
    expect(onVisible).toHaveBeenCalledTimes(1);
    // Consumed: the element leaves the observer, so the browser stops
    // reporting it and the callback cannot fire twice.
    expect(fake.unwatched).toEqual([tile]);

    fake.hit(tile);
    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  it("keeps elements independent", () => {
    const fake = fakeObserver();
    const once = createVisibleOnce(fake.create);
    const first = el("a");
    const second = el("b");
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    once.watch(first, onFirst);
    once.watch(second, onSecond);

    fake.hit(second);
    expect(onSecond).toHaveBeenCalledTimes(1);
    expect(onFirst).not.toHaveBeenCalled();
    expect(fake.unwatched).toEqual([second]);
  });

  it("cancels a watch detached before its hit", () => {
    const fake = fakeObserver();
    const once = createVisibleOnce(fake.create);
    const tile = el("a");
    const onVisible = vi.fn();
    const detach = once.watch(tile, onVisible);

    detach();
    expect(fake.unwatched).toEqual([tile]);
    fake.hit(tile);
    expect(onVisible).not.toHaveBeenCalled();
  });

  it("leaves a re-watch alone when a stale detach arrives late", () => {
    const fake = fakeObserver();
    const once = createVisibleOnce(fake.create);
    const tile = el("a");
    const stale = vi.fn();
    const fresh = vi.fn();
    const detachStale = once.watch(tile, stale);
    once.watch(tile, fresh);

    detachStale();
    fake.hit(tile);
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(fake.unwatched).toEqual([tile]);
  });

  it("is a no-op to detach after the hit", () => {
    const fake = fakeObserver();
    const once = createVisibleOnce(fake.create);
    const tile = el("a");
    const onVisible = vi.fn();
    const detach = once.watch(tile, onVisible);

    fake.hit(tile);
    expect(() => detach()).not.toThrow();
    expect(fake.unwatched).toEqual([tile]); // no second unobserve
    expect(onVisible).toHaveBeenCalledTimes(1);
  });
});
