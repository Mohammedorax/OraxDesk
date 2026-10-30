import { describe, expect, it } from "vitest";
import {
  STALE_MS,
  buildActivityLookup,
  sameActivity,
  sessionKeyOf,
  type ActivitySession,
  type BandwidthSample,
} from "./sessionActivity";

const sample = (rx: number): BandwidthSample => ({ rx, tx: rx / 2 });

function session(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    profileId: "host-1",
    address: "192.168.1.20",
    port: 5900,
    lastStatsAt: 1_000,
    latest: sample(1_000_000),
    samples: [sample(1_000_000)],
    ...overrides,
  };
}

describe("sessionKeyOf", () => {
  it("uses the profile id when there is one, the endpoint otherwise", () => {
    expect(sessionKeyOf({ profileId: "host-1", address: "10.0.0.2", port: 5900 })).toBe("host-1");
    expect(sessionKeyOf({ profileId: null, address: "10.0.0.2", port: 5901 })).toBe(
      "discovered:10.0.0.2:5901",
    );
  });
});

describe("buildActivityLookup", () => {
  it("answers one key per tile in a single map", () => {
    const lookup = buildActivityLookup([session()], {}, 2_000);
    expect([...lookup.keys()]).toEqual(["host-1"]);
    expect(lookup.get("host-1")?.bandwidth?.rx).toBe(1_000_000);
  });

  it("lets the session with the newest stats speak for a key", () => {
    const older = session({ lastStatsAt: 1_000, latest: sample(10) });
    const newer = session({ lastStatsAt: 2_000, latest: sample(20) });
    const lookup = buildActivityLookup([older, newer], {}, 2_500);
    expect(lookup.get("host-1")?.bandwidth?.rx).toBe(20);
  });

  it("stops reporting bandwidth once the sample is old, and says when that is", () => {
    const fresh = buildActivityLookup([session()], {}, 1_000 + STALE_MS);
    expect(fresh.get("host-1")?.bandwidth?.expiresAt).toBe(1_000 + STALE_MS);

    // Nothing fresh and no picture: the key simply has no answer any more.
    const stale = buildActivityLookup([session({ latest: null })], {}, 1_000 + STALE_MS + 1);
    expect(stale.has("host-1")).toBe(false);

    // A picture keeps the tile alive; the reading still drops out.
    const frame = { dataUrl: "data:image/jpeg;base64,AA", width: 360, height: 220 };
    const staleWithFrame = buildActivityLookup(
      [session({ latest: null })],
      { "host-1": frame },
      1_000 + STALE_MS + 1,
    );
    expect(staleWithFrame.get("host-1")?.bandwidth).toBeNull();
  });

  it("keeps a preview off a tile whose session has ended", () => {
    const frame = { dataUrl: "data:image/jpeg;base64,AA", width: 360, height: 220 };
    const live = buildActivityLookup([session()], { "host-1": frame }, 2_000);
    expect(live.get("host-1")?.preview?.dataUrl).toBe(frame.dataUrl);

    const ended = buildActivityLookup([], { "host-1": frame }, 2_000);
    expect(ended.has("host-1")).toBe(false);
  });
});

describe("sameActivity", () => {
  it("treats a rebuilt entry with the same answer as unchanged", () => {
    const frame = { dataUrl: "data:image/jpeg;base64,AA", width: 360, height: 220 };
    // One session object across both builds: the sample array is what the
    // session state keeps immutable, and the comparison relies on that.
    const live = session();
    const first = buildActivityLookup([live], { "host-1": frame }, 2_000);
    const second = buildActivityLookup([live], { "host-1": frame }, 2_001);
    expect(sameActivity(first.get("host-1"), second.get("host-1"))).toBe(true);
  });

  it("notices a new frame", () => {
    const first = buildActivityLookup(
      [session()],
      { "host-1": { dataUrl: "data:image/jpeg;base64,AA", width: 360, height: 220 } },
      2_000,
    );
    const second = buildActivityLookup(
      [session()],
      { "host-1": { dataUrl: "data:image/jpeg;base64,BB", width: 360, height: 220 } },
      2_000,
    );
    expect(sameActivity(first.get("host-1"), second.get("host-1"))).toBe(false);
  });
});
