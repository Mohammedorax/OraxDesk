/**
 * A small fixed-window limiter. It is per isolate, so it is a speed bump, not a
 * global quota: exact cross-isolate limits need a Durable Object (paid). The
 * real bound on abuse is the single-use code, the per-device cap in D1 and the
 * edge rate limiting in front of the Worker.
 */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  allow(key: string, nowMs = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (entry === undefined || nowMs - entry.start >= this.windowMs) {
      if (entry === undefined && this.hits.size >= this.maxKeys) this.prune(nowMs);
      this.hits.set(key, { start: nowMs, count: 1 });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }

  private prune(nowMs: number): void {
    for (const [key, value] of this.hits) {
      if (nowMs - value.start >= this.windowMs) this.hits.delete(key);
    }
    // Still full of live keys: drop everything rather than grow without bound.
    if (this.hits.size >= this.maxKeys) this.hits.clear();
  }
}

/** Codes are guessed against; 20 attempts a minute per address is plenty. */
export const resolveLimiter = new FixedWindowLimiter(20, 60_000);
