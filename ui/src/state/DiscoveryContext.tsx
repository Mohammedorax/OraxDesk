import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DiscoveredHost, DiscoveryEventPayload, ScanProgress } from "../lib/types";
import { inTauri, mustInvoke, safeListen } from "../lib/tauri";
import { MOCK_DISCOVERED, useMockData } from "../lib/mock";

interface DiscoveryContextValue {
  discovered: DiscoveredHost[];
  scan: ScanProgress;
  startScan: () => Promise<void>;
}

const DiscoveryContext = createContext<DiscoveryContextValue | null>(null);

export function DiscoveryProvider({ children }: { children: ReactNode }): ReactNode {
  const mock = useMockData();
  const [discovered, setDiscovered] = useState<DiscoveredHost[]>([]);
  const [scan, setScan] = useState<ScanProgress>({ running: false, done: 0, total: 0 });

  useEffect(() => {
    if (mock) {
      setDiscovered(MOCK_DISCOVERED);
      return;
    }
    if (!inTauri()) return;
    // No "run once" latch.
    //
    // StrictMode runs an effect, cleans it up, and runs it again on the same
    // component instance, so a ref used as a latch means "run, then be
    // cleaned up, and never run again": discovery was started, immediately
    // stopped, and never started again, and the listener leaked because the
    // cleanup ran before the listen promise had resolved. The other three
    // contexts already use the pattern below, where the cleanup and the
    // second run cancel out correctly.
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void safeListen<DiscoveryEventPayload>("discovery://event", (ev) => {
      if (!ev || typeof ev !== "object") return;
      switch (ev.type) {
        case "found":
        case "updated":
          setDiscovered((prev) => {
            const i = prev.findIndex((d) => d.id === ev.host.id);
            if (i >= 0) {
              const next = prev.slice();
              next[i] = ev.host;
              return next;
            }
            return [...prev, ev.host];
          });
          break;
        case "lost":
          setDiscovered((prev) => prev.filter((d) => d.id !== ev.id));
          break;
        case "scan-progress":
          setScan({ running: true, done: ev.done, total: ev.total });
          break;
        case "scan-complete":
          setScan((s) => ({ ...s, running: false }));
          break;
        default:
          break;
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    void mustInvoke("start_discovery").catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
      void mustInvoke("stop_discovery").catch(() => undefined);
    };
  }, [mock]);

  const startScan = useCallback(async (): Promise<void> => {
    if (mock) {
      setScan({ running: true, done: 0, total: 100 });
      let done = 0;
      const iv = window.setInterval(() => {
        done += 10;
        setScan({ running: done < 100, done, total: 100 });
        if (done >= 100) window.clearInterval(iv);
      }, 200);
      return;
    }
    setScan({ running: true, done: 0, total: 0 });
    try {
      await mustInvoke("scan_network");
    } catch {
      // The scan is driven entirely by `discovery://event`, so a command that
      // fails leaves no events to finish it and the button would read
      // "Scanning…" for the rest of the session. Say it failed and stop.
      setScan({ running: false, done: 0, total: 0 });
      throw new Error("The network scan could not be started");
    }
  }, [mock]);

  const value = useMemo(
    () => ({ discovered, scan, startScan }),
    [discovered, scan, startScan],
  );
  return <DiscoveryContext.Provider value={value}>{children}</DiscoveryContext.Provider>;
}

export function useDiscovery(): DiscoveryContextValue {
  const ctx = useContext(DiscoveryContext);
  if (!ctx) throw new Error("useDiscovery outside DiscoveryProvider");
  return ctx;
}
