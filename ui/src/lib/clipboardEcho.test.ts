import { describe, expect, it } from "vitest";
import { ClipboardEcho } from "./clipboardEcho";

describe("ClipboardEcho", () => {
  it("does not push back what it just moved", () => {
    const echo = new ClipboardEcho();
    expect(echo.shouldPush("copied", false)).toBe(true);
    echo.moved("copied");
    expect(echo.shouldPush("copied", false)).toBe(false);
    expect(echo.shouldPush("something else", false)).toBe(true);
  });

  it("pushes on request even when nothing changed", () => {
    const echo = new ClipboardEcho();
    echo.moved("copied");
    expect(echo.shouldPush("copied", true)).toBe(true);
  });

  it("never pushes empty text", () => {
    const echo = new ClipboardEcho();
    expect(echo.shouldPush("", false)).toBe(false);
    expect(echo.shouldPush("", true)).toBe(false);
  });

  // Issue #9: the new connection's clipboard channel starts empty, so the
  // text pushed before the drop has to be offered again.
  it("pushes the same text again after a reconnect", () => {
    const echo = new ClipboardEcho();
    echo.moved("copied before the drop");
    echo.connected();
    expect(echo.shouldPush("copied before the drop", false)).toBe(true);
  });

  it("allows retry after the backend rejects a send", async () => {
    const echo = new ClipboardEcho();
    await expect(echo.push("text", false, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(echo.shouldPush("text", false)).toBe(true);
    await expect(echo.push("text", false, async () => {})).resolves.toBe(true);
    expect(echo.shouldPush("text", false)).toBe(false);
  });

  it("coalesces simultaneous automatic sends of the same text", async () => {
    const echo = new ClipboardEcho();
    let count = 0;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const send = async (): Promise<void> => { count += 1; await wait; };
    const first = echo.push("text", false, send);
    const second = echo.push("text", false, send);
    release();
    expect(await Promise.all([first, second])).toEqual([true, false]);
    expect(count).toBe(1);
  });

  it("does not remember an old send after reconnect", async () => {
    const echo = new ClipboardEcho();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const pending = echo.push("text", false, async () => wait);
    await Promise.resolve();
    echo.connected();
    release();
    await pending;
    expect(echo.shouldPush("text", false)).toBe(true);
  });

  it("keeps a newer remote clipboard event when a local send finishes", async () => {
    const echo = new ClipboardEcho();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const pending = echo.push("local", false, async () => wait);
    await Promise.resolve();
    echo.moved("remote");
    release();
    await pending;
    expect(echo.shouldPush("remote", false)).toBe(false);
    expect(echo.shouldPush("local", false)).toBe(true);
  });
});
