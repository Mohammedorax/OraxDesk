/**
 * A small fixed-window limiter. It is per isolate, so it is a speed bump, not a
 * global quota: exact cross-isolate limits need a Durable Object (paid), or
 * the edge rate limiting in front of the Worker, which is not configured in
 * this repository and is therefore an operational assumption rather than
 * something this code can rely on.
 *
 * The real bound on abuse is the single-use code, the per-device cap in D1 and
 * that edge limit. What this limiter is for is making the cheap abuse
 * expensive, and for not being the thing that gets in the way of an honest
 * client.
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
      // Deleted and set again so the map's insertion order stays the order the
      // windows started in. A key that keeps its old position would be evicted
      // first even though its window is the youngest.
      this.hits.delete(key);
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
    // Still full of live keys: drop the OLDEST ONE, not every one.
    //
    // This used to clear the whole map, which meant that ten thousand
    // distinct source addresses could wipe every client's budget in one go.
    // Since the key is the source address, an attacker with a single IPv6
    // /64 has ten thousand of them, so the one limiter in this repository
    // could be reset at will by whoever it was there to stop.
    while (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done) break;
      this.hits.delete(oldest.value);
    }
  }
}

/** Codes are guessed against; 20 attempts a minute per address is plenty. */
export const resolveLimiter = new FixedWindowLimiter(20, 60_000);

/**
 * Registrations are the one endpoint with no limit of its own.
 *
 * Every registration writes a device row that nothing ever deletes, so an
 * anonymous caller could fill the table with keys it had minted a moment
 * earlier. Twenty a minute per address is far above what a real device does
 * (one, ever) and far below what a flood needs.
 */
export const registerLimiter = new FixedWindowLimiter(20, 60_000);

/**
 * The operator endpoint, which revokes a device from the server side.
 *
 * A secret gates it, so this is not an anti-guessing control; it bounds a
 * runaway automation or a leaked-and-rotated key being used to churn rows.
 * Operator calls are rare by nature, so ten a minute is generous.
 */
export const adminLimiter = new FixedWindowLimiter(10, 60_000);

/**
 * The directory is public and unguessable only in the id, but the NINE DIGIT
 * number is guessable: a billion values, read one at a time, with no
 * authentication. This is the one endpoint where a flood is cheap, so it gets
 * the tightest window of the three.
 */
export const directoryLimiter = new FixedWindowLimiter(30, 60_000);
