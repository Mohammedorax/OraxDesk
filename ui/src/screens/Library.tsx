/** The Library, home surface (PRD/03 §2, PRD/11 §3.1). */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useHosts } from "../state/HostsContext";
import { useDiscovery } from "../state/DiscoveryContext";
import { useSettings, MAX_QUICK_CONNECT_HISTORY, type SortKey } from "../state/SettingsContext";
import { useToasts } from "../state/ToastContext";
import type { DiscoveredHost, HostGroup, HostProfile, ProtocolKind } from "../lib/types";
import { serializeRdpSettings } from "../lib/rdp";
import { serializeSshSettings } from "../lib/ssh";
import { loadSshDefaults } from "../lib/sshDefaults";
import { cleanDisplayName, vncCredentialPayload, vncTakesUsername } from "../lib/hostDraft";
import {
  hostMac,
  hostProtocol,
  protocolLabel,
  resolvedOsHint,
  serializeSshTunnel,
} from "../lib/types";
import {
  allowsMultipleSessions,
  inTauri,
  openSessionWindow,
  safeInvoke,
  safeListen,
  forgetCertificate,
  hasSavedPassword,
  setHasPassword,
  type OpenSessionOptions,
  type SessionWindowOutcome,
} from "../lib/tauri";
import { seedMockThumbnails, useMockData } from "../lib/mock";
import { useSessions } from "../state/SessionsContext";
import { useTabs } from "../state/TabsContext";
import { gridLayout } from "../lib/layout";
import {
  forgetGroupLayout,
  hasSavedLayout,
  restoreLayout,
  saveGroupLayout,
} from "../lib/groupLayout";
import { classNames, describeError, formatBps, fuzzyMatch, modKeyLabel, timeAgo } from "../lib/util";
import { useI18n, useT } from "../lib/i18n";
import { formatTarget } from "../lib/address";
import { Sidebar, type SidebarSelection } from "../components/Sidebar";
import { SidebarDeleteButton } from "../components/SidebarDeleteButton";
import { DeleteHostsDialog } from "../components/DeleteHostsDialog";
import { deleteSelection } from "../lib/hostDeletion";
import { useHostDragSelect, type DropTarget } from "../hooks/useHostDragSelect";
import { HostTile, DiscoveredTile, addressLabel, osLabel } from "../components/HostTile";
import { CommandPalette, type PaletteAction } from "../components/CommandPalette";
import { HostDialog, draftFromHost, type HostDraft } from "../components/HostDialog";
import { loadRdpDefaults } from "../lib/rdpDefaults";
import { QuickConnect } from "../components/QuickConnect";
import { GetHelp } from "../components/GetHelp";
import { BoundaryConnect } from "../components/BoundaryConnect";
import { InboxDialog } from "../components/InboxDialog";
import { mustInvoke } from "../lib/tauri";
import { DeviceIdentityChip } from "../components/DeviceIdentityChip";
import { Wordmark } from "../components/Wordmark";
import { registry } from "../lib/support";
import { ContextMenu, Dialog, EmptyState, Select, TileSkeleton, type MenuItem } from "../components/primitives";
import {
  IconActivity,
  IconAlert,
  IconGrid,
  IconHelp,
  IconList,
  IconMonitor,
  IconPlus,
  IconTabs,
  IconWindows,
  IconZap,
} from "../components/icons";
import { emit, listen } from "@tauri-apps/api/event";
import {
  AGENT_OPEN_EVENT,
  type AgentOpenRequest,
  EDIT_HOST_EVENT,
  type EditHostRequest,
} from "../lib/editHost";

interface CtxMenuState {
  x: number;
  y: number;
  host: HostProfile;
}

/** Secondary click on a group in the sidebar. */
interface GroupMenuState {
  x: number;
  y: number;
  group: HostGroup;
}

/**
 * `.host-grid` uses `auto-fit`, so a two-host library would otherwise stretch
 * those two tiles across the whole window. Capping the grid's width at
 * "how wide N tiles are allowed to be" keeps tiles at a sane size while still
 * letting them fill the content area as soon as there are enough of them.
 */
const TILE_MAX_WIDTH = { normal: 440, compact: 320 };
const TILE_GAP = { normal: 16, compact: 12 };

/**
 * A session id for the browser-dev mock, where there is no shell to mint one.
 * Unique per tab, or two mock sessions would collide on one tab.
 */
function devSessionId(): string {
  return `dev-${Math.random().toString(36).slice(2, 10)}`;
}

function gridCap(count: number, compact: boolean): CSSProperties | undefined {
  if (count <= 0) return undefined;
  const density = compact ? "compact" : "normal";
  return { maxWidth: count * TILE_MAX_WIDTH[density] + (count - 1) * TILE_GAP[density] };
}

export function Library({
  onOpenPreferences,
  onOpenAbout,
  autoAddDiscoveredId = null,
  onAutoAddHandled,
}: {
  onOpenPreferences: () => void;
  onOpenAbout: () => void;
  autoAddDiscoveredId?: string | null;
  onAutoAddHandled?: () => void;
}): ReactNode {
  const { hosts, groups, tags, loading, loadFailed, saveHost, deleteHost, saveGroup, saveTag, setHostTags, setHostsGroup, addTagToHosts, removeTagFromHosts, savePassword, saveSshPassphrase, saveRdpCredentials, wakeHost, toggleFavorite, refresh, reload, refreshThumbnail } = useHosts();
  const { discovered, scan, startScan } = useDiscovery();
  const { settings, update } = useSettings();
  const { livePreviews, setLivePreviews } = useSessions();
  const {
    summaries, open: openTab, select: selectTab, selectSession, has: hasTab,
    activeId: activeTabId, openArranged, adopt, serializeActive,
  } = useTabs();
  /** Is the library the pane on screen, or is a session tab in front of it? */
  const inFront = activeTabId === null;
  const { push } = useToasts();
  const { t } = useI18n();

  const [selection, setSelection] = useState<SidebarSelection>({ kind: "all" });
  const [search, setSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hostDialog, setHostDialog] = useState<HostDraft | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [groupMenu, setGroupMenu] = useState<GroupMenuState | null>(null);
  const [activeTagIds, setActiveTagIds] = useState<Set<string>>(new Set());
  const [tagMode, setTagMode] = useState<"and" | "or">("or");
  const [namePrompt, setNamePrompt] = useState<"group" | "tag" | null>(null);
  /** The machines the sidebar's trash button is about to delete, if it asked. */
  const [deleteAsk, setDeleteAsk] = useState<HostProfile[] | null>(null);
  const quickConnectRef = useRef<HTMLInputElement>(null);

  const focusQuickConnect = useCallback((): void => {
    quickConnectRef.current?.focus();
    quickConnectRef.current?.select();
  }, []);

  // ------------------------------------------------------------ connect

  const tabbed = settings.windowMode === "tabs";

  /**
   * Every connect gesture, in one place.
   *
   * The shell still decides everything that matters, we only act on what it
   * reports back. `reused` means an already-open session was brought forward
   * and nothing new was connected, so the history counter must not be bumped
   * either. `target` says where that session actually lives: a machine opened
   * in its own window before the preference was switched to tabs is still
   * found, and is still raised as a window rather than duplicated into a tab.
   */
  const openSession = useCallback(
    async (
      options: OpenSessionOptions,
      label: string,
      onConnected?: () => void,
    ): Promise<void> => {
      const background = options.background === true;
      let outcome: SessionWindowOutcome | null;
      try {
        outcome = await openSessionWindow({ ...options, asTab: tabbed });
      } catch (err) {
        // The shell refused or failed to open the session. Say so: a connect
        // that fails silently is a button that does nothing, and the user has
        // no way to tell that from a machine that is simply not answering.
        push(
          "danger",
          t("library.connectFailed", { name: label, reason: describeError(err) }),
        );
        return;
      }
      if (!outcome) return;
      // A tab the shell believes is still open, but which is not on the strip,
      // is a session on its way out: `disconnect_session` only ASKS the session
      // to stop, and the shell's liveness test for a tab is whether the library
      // window still exists, which it always does. Closing a tab and
      // reconnecting straight away would otherwise be answered with "already
      // open" and connect nothing at all. Ask once more, saying outright that a
      // new one is wanted.
      if (outcome.reused && outcome.target === "tab" && !hasTab(outcome.sessionId)) {
        try {
          outcome = await openSessionWindow({ ...options, asTab: tabbed, forceNew: true });
        } catch (err) {
          push(
            "danger",
            t("library.connectFailed", { name: label, reason: describeError(err) }),
          );
          return;
        }
        if (!outcome) return;
      }
      if (outcome.reused) {
        // A tab no longer means a session: it is a layout that may hold
        // several, so the session has to be looked up rather than assumed to
        // be the tab's own name. This also lands the keyboard on the right
        // pane, not merely the right tab.
        if (background) return;
        if (outcome.target === "tab") selectSession(outcome.sessionId);
        push("info", t("library.alreadyOpen", { name: label }));
        return;
      }
      if (outcome.target === "tab" && outcome.params) {
        // A tab has no URL to read its parameters out of, so the shell hands
        // them back and we mount the viewer with them.
        openTab(outcome.sessionId, {
          sessionId: outcome.sessionId,
          profileId: outcome.params.profileId,
          address: outcome.params.address,
          port: outcome.params.port,
          name: outcome.params.name,
          protocol: outcome.params.protocol,
        }, undefined, background);
      }
      onConnected?.();
    },
    [tabbed, selectSession, openTab, hasTab, push, t],
  );

  const connectHost = useCallback(
    (host: HostProfile, forceNew = false): void => {
      const protocol = hostProtocol(host);
      if (inTauri()) {
        void openSession({ profileId: host.id, forceNew }, host.friendlyName, () => {
          void safeInvoke("touch_connected", { hostId: host.id }, null);
        });
        return;
      }
      // Browser dev: no shell to resolve anything, so mount the mock session
      // directly. `profileId` rides along exactly as the shell would set it,
      // so the mock session's thumbnail capture attaches to this host.
      if (tabbed) {
        const id = devSessionId();
        openTab(id, {
          sessionId: id,
          profileId: host.id,
          address: host.address,
          port: host.port,
          name: host.friendlyName,
          protocol,
        });
        return;
      }
      window.location.search =
        `?sessionId=dev&profileId=${encodeURIComponent(host.id)}` +
        `&name=${encodeURIComponent(host.friendlyName)}` +
        (protocol === "vnc" ? "" : `&protocol=${protocol}`);
    },
    [openSession, tabbed, openTab],
  );

  const connectAdHoc = useCallback(
    (protocol: ProtocolKind, address: string, port: number, label = address): void => {
      // Say what is being attempted. The session opens in another window or
      // tab, so without this the address bar goes empty and nothing at all
      // happens where the person is looking.
      push(
        "info",
        port
          ? t("library.connectingToPort", { address: label, port })
          : t("library.connectingTo", { address: label }),
      );
      if (inTauri()) {
        void openSession({ address, port, protocol }, label);
        return;
      }
      // Endpoint rides along exactly as the shell sets it: an ad-hoc session
      // is keyed by `discovered:<address>:<port>`, so without it the browser
      // dev session has nothing to attach its capture to.
      if (tabbed) {
        const id = devSessionId();
        openTab(id, {
          sessionId: id,
          profileId: null,
          address,
          port,
          name: address,
          protocol,
        });
        return;
      }
      window.location.search =
        `?sessionId=dev&address=${encodeURIComponent(address)}&port=${port}` +
        `&name=${encodeURIComponent(address)}` +
        (protocol === "vnc" ? "" : `&protocol=${protocol}`);
    },
    [openSession, tabbed, openTab, push, t],
  );

  // A nine-digit number is a device number, not a hostname: resolve it through
  // the registry when one is configured, then connect to that endpoint.
  //
  // `connectAdHoc` is a dependency, not a captured variable. It used to be
  // declared AFTER this callback with an empty dependency list, which froze
  // the very first render's copy of it: the connection then used whatever the
  // window mode was when the library opened, for the rest of the session, so
  // switching between tabs and windows and then typing a number opened the
  // wrong kind of thing.
  const connectAdHocResolved = useCallback(
    (protocol: ProtocolKind, address: string, port: number): void => {
      const digits = address.replace(/[\s.-]/g, "");
      if (
        (protocol === "vnc" || protocol === "boundary") &&
        /^\d{9}$/.test(digits) &&
        inTauri()
      ) {
        push("info", t("library.lookingUpNumber", { number: digits }));
        void (async () => {
          try {
            const registryUrl = await registry.origin();
            if (registryUrl === "") {
              push("danger", t("library.numberNeedsRegistry"));
              return;
            }
            const record = await registry.lookupNumber(registryUrl, digits);
            connectAdHoc("boundary", record.id, 0, digits);
          } catch (err) {
            const reason = describeError(err);
            const missing = /404|not_found|No such device/i.test(reason);
            push(
              "danger",
              missing
                ? t("library.numberNotRegistered", { number: digits })
                : t("library.numberLookupFailed", { number: digits, reason }),
            );
          }
        })();
        return;
      }
      connectAdHoc(protocol, address, port);
    },
    [connectAdHoc, push, t],
  );

  /**
   * Open every machine in a group at once, side by side in one tab.
   *
   * A group that has been arranged before comes back exactly as it was left,
   * down to where the dividers sat. One that has not is laid out as an even
   * grid in whatever order the library is currently sorted, which the user can
   * then rearrange and save, so the arrangement is something a group acquires
   * rather than something it has to be given up front.
   *
   * The panes are created and shown FIRST, then filled as each connection
   * answers. Dialling half a dozen machines takes a moment and they will not
   * finish in any particular order, so the alternative is either a blank window
   * or a layout that shuffles itself as replies arrive.
   */
  const openGroupAsGrid = useCallback(
    (group: HostGroup): void => {
      const childIds = groups.filter((g) => g.parentId === group.id).map((g) => g.id);
      const inGroup = hosts.filter(
        (h) => h.groupId === group.id || (h.groupId !== null && childIds.includes(h.groupId)),
      );
      if (inGroup.length === 0) {
        push("info", t("library.groupEmpty", { group: group.name }));
        return;
      }

      const saved = restoreLayout(group.id);
      // A saved arrangement can name a host that has since been deleted, and
      // the library can have gained hosts since it was saved. Honour the
      // arrangement for what it still knows about, and say so if the two have
      // drifted, rather than silently opening the wrong set of machines.
      let places: Array<{ paneId: string; profileId: string }>;
      let tabId: string;
      if (saved) {
        const known = new Set(inGroup.map((h) => h.id));
        places = saved.places.filter((p) => known.has(p.profileId));
        ({ tabId } = openArranged(saved.root));
        const missing = saved.places.length - places.length;
        const added = inGroup.length - places.length;
        if (missing > 0 || added > 0) {
          push("info", t("library.groupLayoutChanged", { group: group.name }));
        }
      } else {
        const { tabId: id, paneIds } = openArranged(gridLayout(inGroup.length));
        tabId = id;
        places = inGroup.map((h, i) => ({ paneId: paneIds[i], profileId: h.id }));
      }

      for (const { paneId, profileId } of places) {
        const host = inGroup.find((h) => h.id === profileId);
        if (!host) continue;
        if (!inTauri()) {
          const id = devSessionId();
          openTab(
            id,
            {
              sessionId: id,
              profileId: host.id,
              address: host.address,
              port: host.port,
              name: host.friendlyName,
              protocol: hostProtocol(host),
            },
            { tabId, paneId },
          );
          continue;
        }
        void openSessionWindow({ profileId: host.id, asTab: true })
          .then(async (outcome) => {
            if (!outcome) return;
            if (outcome.reused) {
              // Already connected somewhere: move it in rather than refusing.
              // A tab the shell believes is still open but which is not on the
              // strip is a session on its way out (see `openSession`), so ask
              // again for a new one instead of adopting a session no pane can
              // hold. A session in its own window cannot be moved at all, and
              // saying so is better than a pane that silently stays empty.
              if (outcome.target === "window") {
                push("info", t("library.alreadyOpen", { name: host.friendlyName }));
                return;
              }
              if (!hasTab(outcome.sessionId)) {
                try {
                  outcome = await openSessionWindow({
                    profileId: host.id,
                    asTab: true,
                    forceNew: true,
                  });
                } catch (err: unknown) {
                  push(
                    "danger",
                    t("library.connectFailed", {
                      name: host.friendlyName,
                      reason: describeError(err),
                    }),
                  );
                  return;
                }
                if (!outcome) return;
                if (outcome.reused) {
                  push("info", t("library.alreadyOpen", { name: host.friendlyName }));
                  return;
                }
              } else {
                adopt(tabId, paneId, outcome.sessionId);
                return;
              }
            }
            if (outcome.target !== "tab" || !outcome.params) return;
            openTab(
              outcome.sessionId,
              {
                sessionId: outcome.sessionId,
                profileId: outcome.params.profileId,
                address: outcome.params.address,
                port: outcome.params.port,
                name: outcome.params.name,
                protocol: outcome.params.protocol,
              },
              { tabId, paneId },
            );
            void safeInvoke("touch_connected", { hostId: host.id }, null);
          })
          .catch((err: unknown) => {
            push(
              "danger",
              t("library.connectFailed", {
                name: host.friendlyName,
                reason: describeError(err),
              }),
            );
          });
      }
    },
    [groups, hosts, openArranged, openTab, adopt, hasTab, push, t],
  );

  /**
   * Remember the arrangement in front against a group.
   *
   * Offered on the group rather than on the layout because a group is already
   * the name the user gave to "these machines together", and giving layouts
   * names of their own would be a second list to keep in step with the first.
   */
  const saveLayoutToGroup = useCallback(
    (group: HostGroup): void => {
      const serialized = serializeActive();
      if (!serialized) {
        push("info", t("library.openGridFirst"));
        return;
      }
      saveGroupLayout(group.id, serialized);
      push("success", t("library.layoutSaved", { group: group.name }));
    },
    [serializeActive, push, t],
  );

  const groupMenuItems = useCallback(
    (group: HostGroup): MenuItem[] => {
      const items: MenuItem[] = [
        {
          label: hasSavedLayout(group.id)
            ? t("library.menuOpenGridSaved")
            : t("library.menuOpenGrid"),
          onSelect: () => openGroupAsGrid(group),
        },
      ];
      // Only worth offering with a session in front: with the library showing
      // there is no arrangement to save.
      if (activeTabId !== null) {
        items.push({ label: t("library.menuSaveLayout"), onSelect: () => saveLayoutToGroup(group) });
      }
      if (hasSavedLayout(group.id)) {
        items.push({
          label: t("library.menuForgetLayout"),
          onSelect: () => {
            forgetGroupLayout(group.id);
            push("info", t("library.layoutForgotten", { group: group.name }));
          },
        });
      }
      return items;
    },
    [openGroupAsGrid, saveLayoutToGroup, activeTabId, push, t],
  );

  /** Most recent first, no duplicates, oldest dropped past the cap. */
  const rememberQuickConnect = useCallback(
    (address: string): void => {
      update({
        quickConnectHistory: [
          address,
          ...settings.quickConnectHistory.filter((a) => a !== address),
        ].slice(0, MAX_QUICK_CONNECT_HISTORY),
      });
    },
    [settings.quickConnectHistory, update],
  );

  // "Connect in new window" only makes sense when the user has allowed more
  // than one window per computer; otherwise it would be a second Connect.
  // Re-read when a menu opens, since Preferences may have changed it since.
  const [allowMultiple, setAllowMultiple] = useState(false);
  const refreshAllowMultiple = useCallback(() => {
    void allowsMultipleSessions().then(setAllowMultiple);
  }, []);
  useEffect(refreshAllowMultiple, [refreshAllowMultiple]);

  // Browser dev only: stand in for "this machine was connected to once
  // already" so a Nearby tile can be seen with a real picture (see mock.ts).
  const mock = useMockData();
  // The Preferences defaults a new Remote Desktop or SSH host starts with,
  // cached once so building a draft stays synchronous. See `lib/rdpDefaults.ts`
  // and `lib/sshDefaults.ts`. A default with no reader here is worse than no
  // default at all, since Preferences would look like it works while a new
  // SSH host quietly never sees the multiplexer the user picked.
  useEffect(() => {
    void loadRdpDefaults();
    void loadSshDefaults();
  }, []);

  useEffect(() => {
    if (mock) seedMockThumbnails();
  }, [mock]);

  // ------------------------------------------------------------ filtering

  const visibleHosts = useMemo((): HostProfile[] => {
    let list = hosts;
    switch (selection.kind) {
      case "favorites":
        list = list.filter((h) => h.favorite);
        break;
      case "recents":
        list = list.filter((h) => h.lastConnected !== null);
        break;
      case "group": {
        const childIds = groups.filter((g) => g.parentId === selection.id).map((g) => g.id);
        list = list.filter(
          (h) => h.groupId === selection.id || (h.groupId !== null && childIds.includes(h.groupId)),
        );
        break;
      }
      default:
        break;
    }
    if (activeTagIds.size > 0) {
      list = list.filter((h) =>
        tagMode === "and"
          ? [...activeTagIds].every((t) => h.tags.includes(t))
          : [...activeTagIds].some((t) => h.tags.includes(t)),
      );
    }
    if (search.trim()) {
      const tagNames = new Map(tags.map((t) => [t.id, t.name] as const));
      list = list.filter((h) =>
        fuzzyMatch(
          search,
          `${h.friendlyName} ${h.address} ${h.tags.map((t) => tagNames.get(t) ?? "").join(" ")}`,
        ),
      );
    }
    const sorted = [...list];
    const key: SortKey = settings.sortKey;
    sorted.sort((a, b) => {
      switch (key) {
        case "last-connected":
          return (b.lastConnected ?? 0) - (a.lastConnected ?? 0);
        case "frequency":
          return b.connectCount - a.connectCount;
        case "group": {
          const gname = (h: HostProfile): string =>
            groups.find((g) => g.id === h.groupId)?.name ?? "￿";
          return gname(a).localeCompare(gname(b)) || a.friendlyName.localeCompare(b.friendlyName);
        }
        default:
          return a.friendlyName.localeCompare(b.friendlyName);
      }
    });
    if (selection.kind === "recents") {
      sorted.sort((a, b) => (b.lastConnected ?? 0) - (a.lastConnected ?? 0));
    }
    return sorted;
  }, [hosts, groups, tags, selection, search, activeTagIds, tagMode, settings.sortKey]);

  /**
   * Badge every tile, or none.
   *
   * A library that speaks one protocol has nothing to disambiguate, and it is
   * the majority case today; the moment a second one appears every tile needs
   * to say which it is, because a badge on some tiles leaves the user
   * guessing what the unbadged ones are.
   */
  const showProtocol = useMemo(
    () => new Set(hosts.map((h) => h.protocol)).size > 1,
    [hosts],
  );

  const unsavedDiscovered = useMemo(
    () =>
      discovered.filter(
        (d) =>
          d.savedHostId === null &&
          !hosts.some((h) => h.address === d.address && h.port === d.port) &&
          (!search.trim() || fuzzyMatch(search, `${d.name} ${d.address}`)),
      ),
    [discovered, hosts, search],
  );

  const showNearbyBand =
    (selection.kind === "all" || selection.kind === "nearby") && unsavedDiscovered.length > 0;

  // --------------------------------------------------- selection and drag

  /** Display order, which is what a shift-click range and a marquee follow. */
  const visibleOrder = useMemo(() => visibleHosts.map((h) => h.id), [visibleHosts]);
  /** Id lookup: a Cmd+A selection turns every `hosts.find` into a full scan. */
  const hostById = useMemo(() => new Map(hosts.map((h) => [h.id, h] as const)), [hosts]);
  const hostName = useCallback(
    (id: string): string => hostById.get(id)?.friendlyName ?? t("library.hostWord"),
    [hostById, t],
  );

  /** "3 hosts" / "Studio", for toasts about a dropped selection. */
  const describe = useCallback(
    (ids: string[]): string =>
      ids.length === 1 ? hostName(ids[0]) : t("library.hostsCount", { count: ids.length }),
    [hostName, t],
  );

  /**
   * A selection was dropped on a group or a tag in the sidebar.
   *
   * Every branch is undoable, because a drag is the easiest gesture in the app
   * to make by accident: the previous group of each host, and which of them
   * did not already carry the tag, are captured BEFORE the write so Undo can
   * put things back exactly, rather than blanket-clearing.
   */
  const dropOnTarget = useCallback(
    (ids: string[], target: DropTarget): void => {
      const previousGroup = new Map(
        ids.map((id) => [id, hostById.get(id)?.groupId ?? null] as const),
      );
      /**
       * Put every host back in the group it came from.
       *
       * Sequential, not a fan-out: each write ends with its own `refresh()`,
       * and three unordered refreshes can settle on the snapshot taken before
       * the last write landed, leaving a correct database behind a stale grid.
       */
      const undoGroups = async (): Promise<void> => {
        const byGroup = new Map<string | null, string[]>();
        for (const [id, gid] of previousGroup) byGroup.set(gid, [...(byGroup.get(gid) ?? []), id]);
        for (const [gid, members] of byGroup) await setHostsGroup(members, gid);
      };
      // An undo that fails has to say so. Letting the promise reject into
      // nothing is the very bug this change exists to fix, and it is no more
      // acceptable on the way back than on the way there.
      const reportUndo = (run: () => Promise<void>) => (): void => {
        void run().catch((err: unknown) =>
          push("danger", t("library.undoFailed", { reason: String(err) })),
        );
      };

      if (target.kind === "ungroup") {
        // Nothing to do for hosts that are not in a group anyway.
        const grouped = ids.filter((id) => previousGroup.get(id) !== null);
        if (grouped.length === 0) {
          push(
            "info",
            ids.length === 1
              ? t("library.notInGroupOne", { hosts: describe(ids) })
              : t("library.notInGroupMany", { hosts: describe(ids) }),
          );
          return;
        }
        void setHostsGroup(grouped, null).then(
          () =>
            push("success", t("library.removedFromGroup", { hosts: describe(grouped) }), {
              label: t("library.undo"),
              run: reportUndo(undoGroups),
            }),
          (err: unknown) =>
            push("danger", t("library.moveFailed", { reason: String(err) })),
        );
        return;
      }

      if (target.kind === "group") {
        const group = groups.find((g) => g.id === target.id);
        if (!group) return;
        const moving = ids.filter((id) => previousGroup.get(id) !== target.id);
        // Silence here would be indistinguishable from a drop that missed.
        if (moving.length === 0) {
          push("info", t("library.alreadyInGroup", { hosts: describe(ids), group: group.name }));
          return;
        }
        void setHostsGroup(moving, target.id).then(
          () =>
            push("success", t("library.movedToGroup", { hosts: describe(moving), group: group.name }), {
              label: t("library.undo"),
              run: reportUndo(undoGroups),
            }),
          (err: unknown) =>
            push("danger", t("library.moveFailed", { reason: String(err) })),
        );
        return;
      }

      const tag = tags.find((t) => t.id === target.id);
      if (!tag) return;
      // Hosts that already carry the tag are left out of the Undo, or undoing
      // would strip a tag the user had put there earlier by hand.
      const tagging = ids.filter((id) => !(hostById.get(id)?.tags ?? []).includes(target.id));
      if (tagging.length === 0) {
        push("info", t("library.alreadyTagged", { hosts: describe(ids), tag: tag.name }));
        return;
      }
      void addTagToHosts(tagging, target.id).then(
        () =>
          push("success", t("library.taggedWith", { hosts: describe(tagging), tag: tag.name }), {
            label: t("library.undo"),
            run: reportUndo(() => removeTagFromHosts(tagging, target.id)),
          }),
        (err: unknown) => push("danger", t("library.tagFailed", { reason: String(err) })),
      );
    },
    [hostById, groups, tags, setHostsGroup, addTagToHosts, removeTagFromHosts, describe, push, t],
  );

  const {
    selectedIds,
    selectOnly,
    selectAll,
    clear: clearSelection,
    containerRef,
    onPointerDown,
    isGesturing,
    cancelGesture,
    marquee,
    drag,
  } = useHostDragSelect({ order: visibleOrder, onDrop: dropOnTarget });

  /**
   * What the sidebar's trash button may act on.
   *
   * The selection is a set of ids and an id can name a machine that is no
   * longer in the library, so the ids are resolved before anything is
   * deleted (see `lib/hostDeletion.ts`).
   */
  const deletion = useMemo(() => deleteSelection(hosts, selectedIds), [hosts, selectedIds]);

  /**
   * What the Escape / Select-all shortcuts need to know, in a ref.
   *
   * Through the state itself, the keydown effect below would tear down and
   * re-register its window listener every time the selection or a dialog
   * changed, which during a marquee sweep is once per pointer move.
   */
  const selectionKeys = useRef({ overlaid: false, hasSelection: false });
  selectionKeys.current = {
    overlaid:
      hostDialog !== null ||
      paletteOpen ||
      namePrompt !== null ||
      ctxMenu !== null ||
      deleteAsk !== null,
    hasSelection: selectedIds.size > 0,
  };

  const openCtxMenu = useCallback(
    (e: { clientX: number; clientY: number }, host: HostProfile): void => {
      refreshAllowMultiple();
      // Right-clicking outside the selection is a fresh start, exactly as it
      // is in a file manager; inside it, the selection is kept so the menu can
      // act on all of it.
      if (!selectedIds.has(host.id)) selectOnly(host.id);
      setCtxMenu({ x: e.clientX, y: e.clientY, host });
    },
    [refreshAllowMultiple, selectedIds, selectOnly],
  );

  // ------------------------------------------------------------ actions

  /**
   * Carry everything discovery learned into the new-host draft.
   *
   * The MAC especially: Wake-on-LAN cannot work without one and the app has no
   * other way to find it out, so dropping it here means the user must go read
   * it off the machine by hand. `osHint` goes through `resolvedOsHint` so a
   * name proven to come from Windows wins over the server-string guess.
   */
  const addDiscovered = useCallback(
    (d: DiscoveredHost): void => {
      setHostDialog(
        draftFromHost(null, {
          friendlyName: cleanDisplayName(d.name, d.address),
          address: d.address,
          port: d.port,
          // The discovery row already knows what answers on that port, so the
          // editor opens on the right side of the protocol selector rather
          // than making the user notice and switch it.
          protocol: d.protocol ?? "vnc",
          osHint: resolvedOsHint(d),
          wolMac: hostMac(d),
        }),
      );
    },
    [],
  );

  /**
   * Save a discovered machine in one click.
   *
   * Discovery already knows the name, the address, the port, the protocol and
   * the MAC address, so the editor's whole job here is to let a person check
   * and adjust what the app already worked out. Making them fill in a
   * fourteen-field form to keep one machine is the longest possible way to
   * do the shortest thing.
   *
   * Two clicks must still mean one host. The button stays live while the
   * write is in flight (the list refreshes under it), and a fresh draft used
   * to get a fresh UUID per click, so a double click wrote two rows with the
   * same endpoint and two separate keychain entries. An endpoint that is
   * already saved is not written again either: the same address, port and
   * protocol IS the same machine, and adding a second tile for it is a
   * duplicate card, a duplicate key icon and a confusing "which one am I
   * connecting to".
   *
   * The tile's "Edit" button still opens the full form for anyone who wants
   * it, and the toast offers Undo, so nothing is taken away.
   */
  const savingDiscovered = useRef(new Set<string>());
  const saveDiscovered = useCallback(
    (d: DiscoveredHost): void => {
      const protocol = d.protocol ?? "vnc";
      const endpoint = `${protocol}|${d.address}|${d.port}`;
      const existing = hostsRef.current.find(
        (h) => h.protocol === protocol && h.address === d.address && h.port === d.port,
      );
      if (existing) {
        push("info", t("library.alreadyInLibrary", { name: existing.friendlyName }));
        return;
      }
      if (savingDiscovered.current.has(endpoint)) return;
      savingDiscovered.current.add(endpoint);
      const draft = draftFromHost(null, {
        friendlyName: cleanDisplayName(d.name, d.address),
        address: d.address,
        port: d.port,
        protocol,
        osHint: resolvedOsHint(d),
        wolMac: hostMac(d),
      });
      void (async () => {
        try {
          const created = await saveHost({
            id: draft.id,
            friendlyName: draft.friendlyName,
            address: draft.address,
            port: draft.port,
            protocol: draft.protocol,
            osHint: draft.osHint,
            wolMac: draft.wolMac,
            securityPref: null,
            qualityPref: "auto",
            scalingMode: "aspect-fit",
            keyboardMode: "auto",
            passthrough: false,
            sshTunnel: null,
            groupId: null,
            tags: [],
            hasPassword: false,
            rdpSettings: null,
            sshSettings: null,
          });
          if (!created) return;
          push("success", t("library.added", { name: created.friendlyName }), {
            label: t("library.undo"),
            run: () => {
              // Exactly the row this click created. Matching on address and
              // port instead would take out a profile that was already saved
              // by hand before the tile was ever clicked.
              void deleteHost(created.id).catch((err: unknown) =>
                push("danger", t("library.removeFailed", { reason: describeError(err) })),
              );
            },
          });
        } catch (err) {
          push(
            "danger",
            t("library.saveFailed", { name: d.name, reason: describeError(err) }),
          );
        } finally {
          savingDiscovered.current.delete(endpoint);
        }
      })();
    },
    [saveHost, deleteHost, push, t],
  );

  /** The MAC discovery is currently reporting for this endpoint, if any. */
  const discoveredMacFor = useCallback(
    (address: string, port: number): string | null => {
      const d = discovered.find((x) => x.address === address && x.port === port);
      return hostMac(d);
    },
    [discovered],
  );

  /**
   * Edit a saved host, offering the MAC discovery has since learned when the
   * profile has none. It is only a pre-fill, nothing is written until Save, * so a host added before NetBIOS lookups existed can pick one up simply by
   * being opened.
   */
  // Read inside the listener rather than captured, so the subscription is
  // not torn down and rebuilt every time a host list arrives.
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;

  const editHost = useCallback(
    (host: HostProfile): void => {
      setHostDialog(
        draftFromHost(
          host,
          host.wolMac ? undefined : { wolMac: discoveredMacFor(host.address, host.port) },
        ),
      );
    },
    [discoveredMacFor],
  );

  /**
   * A session window asked for a host's security settings.
   *
   * The disconnect panel names a setting, and the editor lives here rather
   * than in the session window, so the request arrives as a broadcast. The
   * dialog opens with Advanced and Security already expanded, which
   * `HostDialog` does for itself whenever either of those switches is on and
   * which is exactly the state a user sent here needs.
   */
  useEffect(() => {
    if (!inTauri()) return;
    let stop: (() => void) | null = null;
    void listen<EditHostRequest>(EDIT_HOST_EVENT, (e) => {
      const host = hostsRef.current.find((h) => h.id === e.payload?.hostId);
      if (host) editHost(host);
    }).then((un) => {
      stop = un;
    });
    return () => stop?.();
  }, [editHost]);

  /**
   * An agent opening a machine goes through the SAME path as a click, so it
   * lands in a tab or a window according to the person's preference, is
   * de-duplicated against a session already open, and is mounted by the code
   * that mounts every other session. See `AGENT_OPEN_EVENT`.
   */
  useEffect(() => {
    if (!inTauri()) return;
    let stop: (() => void) | null = null;
    void listen<AgentOpenRequest>(AGENT_OPEN_EVENT, (e) => {
      const ask = e.payload;
      if (!ask) return;
      const host = ask.hostId ? hostsRef.current.find((h) => h.id === ask.hostId) : undefined;
      const background = ask.background === true;
      const options: OpenSessionOptions = host
        ? { profileId: host.id, background }
        : { address: ask.address, port: ask.port, protocol: ask.protocol, background };
      void openSession(options, host?.friendlyName || ask.address);
    }).then((un) => {
      stop = un;
    });
    return () => stop?.();
  }, [openSession]);

  const saveDraft = useCallback(
    async (draft: HostDraft): Promise<void> => {
      let saved: HostProfile | null;
      try {
        saved = await saveHost({
          id: draft.id,
          friendlyName: draft.friendlyName,
          address: draft.address,
          port: draft.port,
          groupId: draft.groupId,
          osHint: draft.osHint,
          securityPref: draft.securityPref,
          qualityPref: draft.qualityPref,
          scalingMode: draft.scalingMode,
          keyboardMode: draft.keyboardMode,
          passthrough: draft.passthrough,
          sshTunnel: serializeSshTunnel(draft.sshTunnel),
          wolMac: draft.wolMac,
          tags: draft.tagIds,
          hasPassword: draft.hasPassword,
          protocol: draft.protocol,
          // An untouched settings object stores null, so the column only fills
          // once the user actually changes something and the Rust side keeps
          // applying its own defaults.
          rdpSettings: draft.protocol === "rdp" ? serializeRdpSettings(draft.rdp) : null,
          sshSettings: draft.protocol === "ssh" ? serializeSshSettings(draft.ssh) : null,
        });
      } catch (err) {
        // The profile was not written. Say so and keep the dialog open, with
        // everything the user typed still in it, rather than closing it and
        // claiming success.
        push(
          "danger",
          t("library.saveFailed", { name: draft.friendlyName, reason: describeError(err) }),
        );
        return;
      }
      const id = saved?.id ?? draft.id;
      if (id) {
        // An RDP password belongs with its user name and domain, which are
        // three fields of one credential rather than a password on its own.
        //
        // Everything from here on is a separate write, and each one can fail
        // on its own: the keychain can refuse, the vault can be locked. A
        // failure is reported, and the profile that WAS written stays
        // written, so the user is told exactly what went wrong rather than
        // being handed a blanket "could not save".
        try {
          if (draft.protocol === "rdp") {
            await saveRdpCredentials(id, {
              user: draft.rdpUser,
              domain: draft.rdpDomain,
              password: draft.password,
            });
          } else if (draft.protocol === "ssh") {
            // `save_password` (Rust) already carries `sshUser` / `sshPassword`
            // fields alongside the existing `sshPassphrase` (see
            // `StoredCredentials` in crates/vnc-store/src/models.rs), and
            // `connect_session` reads exactly this pair for SSH account
            // password auth. There is no `saveSshCredentials` wrapper in
            // HostsContext yet, only `savePassword` (hardcoded to
            // `vncPassword`) and `saveSshPassphrase` (hardcoded to
            // `sshPassphrase`), and HostsContext.tsx is outside this change's
            // scope, so this calls the command directly, rather than adding a
            // new context method.
            // Only non-empty fields are sent, matching `saveRdpCredentials`'s
            // own rule: an empty box means "keep what is stored", not "erase
            // it", and a merge on the Rust side is what makes that true.
            const payload: Record<string, string> = {};
            if (draft.sshUser.trim()) payload.sshUser = draft.sshUser.trim();
            if (draft.password) payload.sshPassword = draft.password;
            if (Object.keys(payload).length > 0) {
              await mustInvoke("save_password", { hostId: id, creds: payload });
              // `saveRdpCredentials` flips `hasPassword` in local state itself
              // after a write like this one, which needs `setHosts` and so
              // lives in HostsContext.tsx, outside this change's scope. A
              // refresh gets the library's key icon to the same correct end
              // state by re-reading it from the backend instead.
              if (payload.sshPassword) await refresh();
            }
          } else if (draft.protocol === "vnc") {
            // A Mac's Screen Sharing, and the other RFB methods that sign in
            // with an account, keep the user name beside the password in the
            // `vencrypt*` pair, which is where `connect_session` looks first
            // and where a post-connect save puts them too. The password only
            // case is still `savePassword`, unchanged.
            const payload = vncCredentialPayload(
              draft.vncUser,
              draft.password,
              vncTakesUsername(draft.securityPref, draft.osHint),
            );
            if (payload?.vncPassword && !payload.vencryptUser && !payload.vencryptPass) {
              await savePassword(id, payload.vncPassword);
            } else if (payload) {
              await mustInvoke("save_password", { hostId: id, creds: payload });
              // Same reason as the SSH branch: the key icon is re-read rather
              // than flipped here.
              if (payload.vencryptPass) await refresh();
            }
          } else if (draft.password) {
            await savePassword(id, draft.password);
          }
          if (draft.sshPassphrase) await saveSshPassphrase(id, draft.sshPassphrase);
          await setHostTags(id, draft.tagIds);
        } catch (err) {
          // The profile itself is saved. What failed is one of the secrets
          // that go with it, so say that and not "could not save the host".
          push(
            "danger",
            t("library.savedWithoutPassword", {
              name: draft.friendlyName,
              reason: describeError(err),
            }),
          );
          setHostDialog(null);
          return;
        }
      }
      setHostDialog(null);
      // The one thing a person usually wants next is to connect to the
      // computer they have just added, and the toast is where that belongs.
      push(
        "success",
        draft.isNew
          ? t("library.added", { name: draft.friendlyName })
          : t("library.hostUpdated"),
        {
          label: t("quick.connect"),
          run: () => {
            const saved = hostsRef.current.find((h) => h.id === id);
            if (saved) connectHost(saved);
          },
        },
      );
    },
    [saveHost, savePassword, saveSshPassphrase, saveRdpCredentials, setHostTags, refresh, push, connectHost, t],
  );

  const paletteActions = useMemo((): PaletteAction[] => {
    return [
      // Sessions open in tabs are reachable from here as well as from the
      // strip, so a library with a long list of machines still has one keyboard
      // route back to the one you were working in.
      ...summaries.map((summary, i) => ({
        id: `go-to-tab-${summary.id}`,
        label: t("library.paletteGoTo", { title: summary.title }),
        hint: i < 8 ? `${modKeyLabel}${i + 2}` : "",
        run: () => selectTab(summary.id),
      })),
      { id: "new-host", label: t("host.new"), hint: "", run: () => setHostDialog(draftFromHost(null)) },
      { id: "quick-connect", label: t("library.paletteConnectAddress"), hint: `${modKeyLabel}T`, run: focusQuickConnect },
      { id: "scan", label: t("about.scanNetwork"), hint: "", run: () => void startScan().catch((err: unknown) => push("danger", describeError(err))) },
      {
        id: "toggle-view",
        label: settings.libraryView === "grid" ? t("library.paletteSwitchList") : t("library.paletteSwitchGrid"),
        run: () => update({ libraryView: settings.libraryView === "grid" ? "list" : "grid" }),
      },
      { id: "preferences", label: t("about.shortcut.preferences"), run: onOpenPreferences },
      { id: "refresh", label: t("library.paletteRefresh"), run: () => void reload() },
      { id: "help", label: t("library.paletteHelp"), run: onOpenAbout },
      { id: "about", label: t("about.title"), run: onOpenAbout },
    ];
    }, [summaries, selectTab, settings.libraryView, update, startScan, focusQuickConnect, onOpenPreferences, onOpenAbout, reload, push, t]);


  // Onboarding hand-off: open the add dialog pre-filled from a discovered host.
  // The pending id is only cleared when the host was actually found: clearing
  // it while the entry had already vanished (a `lost` event between the two
  // screens) dismissed the hand-off with no dialog and no message at all.
  useEffect(() => {
    if (!autoAddDiscoveredId) return;
    const d = discovered.find((x) => x.id === autoAddDiscoveredId);
    if (!d) return;
    addDiscovered(d);
    onAutoAddHandled?.();
  }, [autoAddDiscoveredId, discovered, addDiscovered, onAutoAddHandled]);

  /**
   * Restore a deleted host, with the key icon telling the truth.
   *
   * `delete_host` drops the profile AND its keychain entry, and the profile we
   * kept for Undo still says a password was saved. Writing that flag back drew
   * a key icon for a secret that no longer exists — the tile claimed a saved
   * password and the next connect asked for one. The vault may also have
   * refused to delete (locked), so the answer is asked for rather than
   * assumed: `has_password` reports what is in the keychain now.
   */
  const restoreHost = useCallback(
    async (host: HostProfile): Promise<void> => {
      const restored = await saveHost({ ...host, hasPassword: false });
      if (!restored) return;
      const saved = await hasSavedPassword(restored.id, hostProtocol(restored));
      if (saved === true) await setHasPassword(restored.id, true);
    },
    [saveHost],
  );

  /**
   * Delete the machines the sidebar's trash button asked about.
   *
   * The same delete the tile's own menu makes, and the same toast with an
   * Undo: the sidebar button is a second way in, not a second behaviour.
   *
   * One machine at a time, because each delete ends with its own refresh
   * and the toast must not claim the work is done before any of it has been
   * attempted. The machines that actually went are the ones the Undo
   * restores, not the ones that were asked for: a delete that failed is
   * still there, and restoring it would say it had been removed.
   */
  const deleteHosts = useCallback(
    async (doomed: HostProfile[]): Promise<void> => {
      const gone: HostProfile[] = [];
      for (const h of doomed) {
        try {
          await deleteHost(h.id);
          gone.push(h);
        } catch (err) {
          push(
            "danger",
            t("library.deleteFailed", { name: h.friendlyName, reason: describeError(err) }),
          );
        }
      }
      if (gone.length === 0) return;
      clearSelection();
      push(
        "info",
        gone.length === 1
          ? t("library.deleted", { name: gone[0].friendlyName })
          : t("library.deletedMany", { count: gone.length }),
        {
          label: t("library.undo"),
          run: () => {
            void (async () => {
              for (const h of gone) await restoreHost(h);
            })().catch((err: unknown) =>
              push("danger", t("library.restoreFailed", { reason: describeError(err) })),
            );
          },
        },
      );
    },
    [deleteHost, restoreHost, clearSelection, push, t],
  );

  // ------------------------------------------------------------ hotkeys

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // These listen on `window`, and in tabbed view the library stays mounted
      // behind whichever session is in front. Without this, Cmd+F would move
      // the focus into a search box nobody can see.
      if (!inFront) return;
      const mod = e.metaKey || e.ctrlKey;
      // Typing in the search box or a dialog field: only the app-level
      // shortcuts below apply, "select all" belongs to the text there.
      // `instanceof` rather than a cast: a keydown delivered with no element
      // target (window) would otherwise throw on `.closest` and take the rest
      // of these shortcuts down with it.
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing = el?.closest("input, textarea, select") != null;
      // A dialog, the palette or a context menu is in front: Escape belongs to
      // whatever is on top, and selecting every tile behind a modal (then
      // popping the selection bar up underneath it) helps nobody.
      const { overlaid, hasSelection } = selectionKeys.current;
      if (mod && e.key.toLowerCase() === "a" && !typing && !overlaid) {
        e.preventDefault();
        selectAll();
        return;
      }
      // One owner for Escape. Mid-gesture it means "cancel this sweep", which
      // puts back the selection the sweep started from; otherwise it clears.
      if (e.key === "Escape" && !typing && !overlaid) {
        if (isGesturing()) cancelGesture();
        else if (hasSelection) clearSelection();
        else return;
        return;
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === "t") {
        e.preventDefault();
        focusQuickConnect();
      } else if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        quickConnectRef.current?.focus();
        quickConnectRef.current?.select();
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setHostDialog(draftFromHost(null));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inFront, focusQuickConnect, selectAll, clearSelection, isGesturing, cancelGesture]);

  // The library's own Windows/Linux menu items, delivered the same way the
  // session items are. `menu:connect` and `menu:wake` act on the host selected
  // here, which is why `menu.rs` routes them to this window rather than to
  // whichever session has the focus.
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void safeListen<{ id: string }>("menu://action", ({ id }) => {
      if (id === "menu:connect" || id === "menu:wake") {
        selectTab(null);
        const chosen = [...selectedIdsRef.current]
          .map((hostId) => hostsRef.current.find((h) => h.id === hostId))
          .filter((h): h is HostProfile => h !== undefined);
        // Both gestures act on one machine. Nine selected and "Connect" is
        // not a request to dial nine hosts by accident, the context menu
        // already says the same thing.
        if (chosen.length !== 1) {
          push(
            "info",
            t(id === "menu:connect" ? "library.selectOneToConnect" : "library.selectOneToWake"),
          );
          return;
        }
        const host = chosen[0];
        if (id === "menu:connect") {
          connectHost(host);
          return;
        }
        if (!host.wolMac) {
          push("info", t("library.wakeNeedsMac"));
          return;
        }
        void wakeHost(host.id)
          .then(() => push("info", t("library.magicPacketSent", { name: host.friendlyName })))
          .catch((err: unknown) =>
            push(
              "danger",
              t("library.wakeFailed", {
                name: host.friendlyName,
                reason: describeError(err),
              }),
            ),
          );
        return;
      }
      if (id !== "menu:quick-connect" && id !== "menu:new-host") return;
      selectTab(null);
      // Focus cannot land on an element that is still hidden, so let the pane
      // swap paint first.
      requestAnimationFrame(() => {
        if (id === "menu:quick-connect") focusQuickConnect();
        else setHostDialog(draftFromHost(null));
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [focusQuickConnect, selectTab, connectHost, wakeHost, push, t]);

  /**
   * A recent machine picked from the tray icon.
   *
   * `tray.rs` raises the library and emits the host id; nothing was listening,
   * so the gesture changed the window and connected nothing. The tray menu is
   * built at startup, so a host deleted since is answered with a sentence
   * rather than silence.
   */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void safeListen<{ hostId: string }>("tray://connect", ({ hostId }) => {
      const host = hostsRef.current.find((h) => h.id === hostId);
      if (!host) {
        push("info", t("library.hostGone"));
        return;
      }
      connectHost(host);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [connectHost, push, t]);

  // ------------------------------------------------------------ context menu

  /**
   * Menu for a right-click inside a multi-selection. Connect and Edit are
   * deliberately absent: they are single-host gestures, and "connect to nine
   * machines at once" is not something to offer by accident.
   */
  const multiMenuItems = useCallback(
    (ids: string[]): MenuItem[] => {
      const grouped = ids.filter((id) => hosts.find((h) => h.id === id)?.groupId);
      return [
        {
          label: t("library.menuRemoveFromGroup", { count: ids.length }),
          disabled: grouped.length === 0,
          onSelect: () => dropOnTarget(ids, { kind: "ungroup" }),
        },
        ...groups.map((g) => ({
          label: t("library.menuMoveTo", { group: g.name }),
          onSelect: () => dropOnTarget(ids, { kind: "group", id: g.id }),
        })),
        ...tags.map((tag) => ({
          label: t("library.menuTagWith", { tag: tag.name }),
          separatorAbove: tag.id === tags[0]?.id,
          onSelect: () => dropOnTarget(ids, { kind: "tag", id: tag.id }),
        })),
        {
          label: t("library.menuDeleteMany", { count: ids.length }),
          danger: true,
          separatorAbove: true,
          onSelect: () => {
            const doomed = ids
              .map((id) => hostById.get(id))
              .filter((h): h is HostProfile => h !== undefined);
            clearSelection();
            // Awaited, and one at a time: each delete ends with its own
            // refresh, and the toast must not claim the work is done before
            // any of it has been attempted.
            void (async () => {
              // One host failing to delete does not stop the rest, and the
              // count in the message is the count that actually went.
              let deleted = 0;
              for (const h of doomed) {
                try {
                  await deleteHost(h.id);
                  deleted += 1;
                } catch (err) {
                  push(
                    "danger",
                    t("library.deleteFailed", {
                      name: h.friendlyName,
                      reason: describeError(err),
                    }),
                  );
                }
              }
              if (deleted === 0) return;
              // Undo restores the profiles and their tags. It cannot bring
              // back the saved passwords: `delete_host` drops the keychain
              // entry, the history rows and the thumbnail, and none of those
              // are recoverable from here. Say so rather than promise more
              // than the button delivers.
              push("info", t("library.deletedMany", { count: deleted }), {
                label: t("library.undo"),
                run: () => {
                  void (async () => {
                    for (const h of doomed) await restoreHost(h);
                  })().catch((err: unknown) =>
                    push(
                      "danger",
                      t("library.restoreFailed", { reason: describeError(err) }),
                    ),
                  );
                },
              });
            })();
          },
        },
      ];
    },
    [hostById, groups, tags, dropOnTarget, deleteHost, restoreHost, clearSelection, push, t],
  );

  const menuItemsFor = useCallback(
    (host: HostProfile): MenuItem[] => [
      { label: t("quick.connect"), onSelect: () => connectHost(host) },
      ...(allowMultiple
        ? [
            {
              label: tabbed
                ? t("library.menuConnectNewTab")
                : t("library.menuConnectNewWindow"),
              onSelect: () => connectHost(host, true),
            },
          ]
        : []),
      {
        label: t("library.menuEdit"),
        onSelect: () => editHost(host),
      },
      {
        label: host.favorite
          ? t("library.menuRemoveFavorite")
          : t("library.menuAddFavorite"),
        onSelect: () => toggleFavorite(host.id),
      },
      {
        label: t("library.menuDuplicate"),
        onSelect: () =>
          void saveHost({
            ...host,
            id: undefined,
            friendlyName: t("library.copyName", { name: host.friendlyName }),
            hasPassword: false,
          }).catch((err: unknown) =>
            push(
              "danger",
              t("library.duplicateFailed", {
                name: host.friendlyName,
                reason: describeError(err),
              }),
            ),
          ),
      },
      {
        label: t("library.menuWake"),
        disabled: !host.wolMac,
        // A greyed-out row with no reason is a dead end: the person cannot
        // tell whether the app has forgotten something, whether there is
        // something to do first, or whether the row is simply broken. This
        // host has no MAC address, and that is the whole reason.
        disabledReason: host.wolMac ? undefined : t("library.wakeNeedsMac"),
        onSelect: () => {
          // The message waits for the packet to have been sent. The Rust side
          // refuses when the host has no MAC address stored, and the old code
          // said "Magic packet sent" whether or not that had happened.
          void wakeHost(host.id)
            .then(() => push("info", t("library.magicPacketSent", { name: host.friendlyName })))
            .catch((err: unknown) =>
              push(
                "danger",
                t("library.wakeFailed", {
                  name: host.friendlyName,
                  reason: describeError(err),
                }),
              ),
            );
        },
      },
      {
        // Thumbnails are captured by the SESSION window (capture_thumbnail
        // takes a raw RGBA body, not a host id), so from here we can only
        // re-read what the store already has.
        label: t("library.menuReloadThumbnail"),
        onSelect: () => refreshThumbnail(host.id),
      },
      {
        // A changed server key is a deliberate hard stop that cannot be
        // clicked through, so without this a legitimately rebuilt machine, // new TLS certificate or new RA2 key, would be permanently
        // unreachable. Forgetting returns it to first-contact state, where the
        // usual "Trust this computer" prompt applies.
        label: t("library.menuForgetKey"),
        onSelect: () => {
          // `forgetCertificate` propagates failures now: this button exists to
          // make a hard-stopped machine reachable again, so a refusal (ACL,
          // storage) has to be visible or the user is left believing it was
          // fixed while every connect still stops.
          void forgetCertificate(host.address, host.port).then(
            () => push("info", t("library.forgotKey", { name: host.friendlyName })),
            (error: unknown) =>
              push(
                "danger",
                t("library.forgetKeyFailed", {
                  name: host.friendlyName,
                  reason: describeError(error),
                }),
              ),
          );
        },
      },
      {
        label: t("library.menuDelete"),
        danger: true,
        separatorAbove: true,
        // The same question the sidebar's trash button asks. Deleting from
        // here used to be a single click plus an Undo that could not restore
        // the saved password, which is the one part of a host that cannot be
        // rebuilt from the profile; the confirmation is the last moment where
        // that is still true.
        onSelect: () => setDeleteAsk([host]),
      },
    ],
    [allowMultiple, tabbed, connectHost, editHost, saveHost, wakeHost, refreshThumbnail, push, t],
  );

  // ------------------------------------------------------------ render

  const nothingSaved = !loading && hosts.length === 0;
  /**
   * The window is genuinely empty: nothing saved, nothing discovered, and no
   * failed read to explain the gap.
   *
   * Support lives in one place at a time. This is the empty state that already
   * offers help and "reach a computer" as full-size buttons, so the sidebar's
   * copies of the same two actions would be a second set in one window; once
   * there are tiles to look at, the sidebar is where they belong. A failed
   * read is not this state: it has no hero buttons, so the sidebar keeps its
   * own.
   */
  const emptyState = nothingSaved && unsavedDiscovered.length === 0 && !loadFailed;
  const gridClass = classNames("host-grid", settings.compact && "is-compact");

  return (
    <div className="flex h-full flex-col bg-canvas">
      {/* Top bar */}
      {/*
        It wraps.
        
        The bar is a single row of eight fixed controls and a search field,
        and it used not to wrap: below about 900 pixels it ran off the side
        of the window with nothing to scroll to, so the buttons at the end
        of it could not be reached at all. Wrapping puts the last of them on
        a second row, which is a smaller thing to ask of a person than a
        control they cannot see.
      */}
      <header className="flex flex-wrap items-center gap-3 border-b border-subtle bg-surface/80 px-4 py-2.5">
        <span className="mr-1 flex shrink-0 items-center gap-2">
          <img
            src="/brand/icon-64.png"
            alt=""
            aria-hidden="true"
            className="size-5 rounded-[5px]"
          />
          <h1 className="text-sm text-primary">
            <Wordmark />
          </h1>
        </span>
        {/* The machine's number, beside its name: the one place a person is
            already looking when somebody asks them for it. It used to be a
            full-width card on a row of its own under this bar. */}
        <DeviceIdentityChip />
        <QuickConnect
          hosts={hosts}
          discovered={discovered}
          recents={settings.quickConnectHistory}
          inputRef={quickConnectRef}
          onConnectHost={connectHost}
          onConnectAddress={connectAdHocResolved}
          onRemember={rememberQuickConnect}
          onSearch={setSearch}
          embedded
          showSupport={false}
        />
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-secondary">
          {t("library.sort")}
          <Select
            wrapperClassName="!inline-block"
            className="!w-auto !py-1 text-xs"
            aria-label={t("library.sortAria")}
            value={settings.sortKey}
            onChange={(e) => update({ sortKey: e.target.value as SortKey })}
          >
            <option value="name">{t("host.name")}</option>
            <option value="last-connected">{t("library.sortLastConnected")}</option>
            <option value="frequency">{t("library.sortMostUsed")}</option>
            <option value="group">{t("host.group")}</option>
          </Select>
        </label>
        <div className="flex overflow-hidden rounded-sm border border-subtle" role="group" aria-label={t("library.viewMode")}>
          <button
            type="button"
            aria-label={t("library.gridView")}
            aria-pressed={settings.libraryView === "grid"}
            className={classNames("p-1.5", settings.libraryView === "grid" ? "bg-accent text-accent-fg" : "text-secondary hover:bg-inset")}
            onClick={() => update({ libraryView: "grid" })}
          >
            <IconGrid size={15} />
          </button>
          <button
            type="button"
            aria-label={t("library.listView")}
            aria-pressed={settings.libraryView === "list"}
            className={classNames("p-1.5", settings.libraryView === "list" ? "bg-accent text-accent-fg" : "text-secondary hover:bg-inset")}
            onClick={() => update({ libraryView: "list" })}
          >
            <IconList size={15} />
          </button>
        </div>
        {/* The same preference as Connections > "Show sessions as tabs", within
            reach of the moment it matters: about to connect. It decides where
            the NEXT session goes, so sessions already running stay put. */}
        <div className="flex overflow-hidden rounded-sm border border-subtle" role="group" aria-label={t("library.sessionsWhere")}>
          <button
            type="button"
            aria-label={t("library.sessionsInWindows")}
            title={t("library.sessionOwnWindow")}
            aria-pressed={!tabbed}
            className={classNames("p-1.5", !tabbed ? "bg-accent text-accent-fg" : "text-secondary hover:bg-inset")}
            onClick={() => update({ windowMode: "windows" })}
          >
            <IconWindows size={15} />
          </button>
          <button
            type="button"
            aria-label={t("library.sessionsAsTabs")}
            title={t("library.sessionsAsTabs")}
            aria-pressed={tabbed}
            className={classNames("p-1.5", tabbed ? "bg-accent text-accent-fg" : "text-secondary hover:bg-inset")}
            onClick={() => update({ windowMode: "tabs" })}
          >
            <IconTabs size={15} />
          </button>
        </div>
        <button
          type="button"
          aria-pressed={livePreviews}
          aria-label={t("library.livePreviews")}
          title={t("library.livePreviewsHint")}
          className={classNames(
            "overflow-hidden rounded-sm border border-subtle p-1.5",
            livePreviews ? "bg-accent text-accent-fg" : "text-secondary hover:bg-inset",
          )}
          onClick={() => setLivePreviews(!livePreviews)}
        >
          <IconActivity size={15} />
        </button>
        <button type="button" className="btn-secondary relative overflow-hidden" onClick={() => void startScan().catch((err: unknown) => push("danger", describeError(err)))}>
          {scan.running ? (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-inset">
              <span
                className={classNames("block h-full bg-accent", scan.total === 0 && "indeterminate-bar w-1/3")}
                style={scan.total > 0 ? { width: `${(scan.done / scan.total) * 100}%` } : undefined}
              />
            </span>
          ) : null}
          <IconZap size={14} />
          {scan.running ? t("library.scanning") : t("about.scanNetwork")}
        </button>
        <button type="button" className="btn-primary" onClick={() => setHostDialog(draftFromHost(null))}>
          <IconPlus size={14} /> {t("host.new")}
        </button>
        {/* Routed through the same event the native menu's About item emits,
            so one listener (App.tsx) owns opening the dialog everywhere. */}
        <button
          type="button"
          aria-label={t("library.aboutAndHelp")}
          title={t("library.aboutAndHelp")}
          className="overflow-hidden rounded-sm border border-subtle p-1.5 text-secondary hover:bg-inset"
          onClick={() => void emit("menu://action", { id: "menu:about" })}
        >
          <IconHelp size={15} />
        </button>
      </header>

      {/* `relative` anchors the floating selection bar: it must NOT be part of
          the flow, or appearing on the first click would push every tile down
          by its height and land the second click of a Shift-range on the wrong
          row. */}
      <div className="relative flex min-h-0 flex-1">
        <Sidebar
          hosts={hosts}
          groups={groups}
          tags={tags}
          nearbyCount={unsavedDiscovered.length}
          selection={selection}
          onSelect={setSelection}
          activeTagIds={activeTagIds}
          tagMode={tagMode}
          onToggleTag={(id) =>
            setActiveTagIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onToggleTagMode={() => setTagMode((m) => (m === "and" ? "or" : "and"))}
          onNewGroup={() => setNamePrompt("group")}
          onNewTag={() => setNamePrompt("tag")}
          onOpenPreferences={onOpenPreferences}
          onGroupContextMenu={(group, x, y) => setGroupMenu({ group, x, y })}
          dragging={drag !== null}
          dropOverKey={drag?.over ?? null}
          actions={
            <SidebarDeleteButton
              targets={deletion.targets}
              onAsk={() => setDeleteAsk(deletion.targets)}
            />
          }
          footer={
            emptyState ? undefined : (
              <div className="flex flex-col gap-2">
                <GetHelp />
                <BoundaryConnect />
                <InboxDialog />
              </div>
            )
          }
        />

        <main
          ref={containerRef}
          onPointerDown={onPointerDown}
          // select-none on the whole pane, not just the tiles: a marquee that
          // starts on a heading or on the empty-state copy would otherwise
          // drag a text highlight along with the rectangle.
          className="min-w-0 flex-1 select-none overflow-y-auto p-4"
          aria-label={t("library.hosts")}
        >
          {loading ? (
            <div className={gridClass} style={gridCap(8, settings.compact)}>
              {Array.from({ length: 8 }, (_, i) => (
                <TileSkeleton key={i} />
              ))}
            </div>
          ) : loadFailed && hosts.length === 0 ? (
            /*
              A failed read is not an empty library. Showing "How do you want
              to start?" here told the person their machines were gone when
              the app had simply not managed to ask the store, and offered
              them a scan or a new host as if nothing had ever been saved.
            */
            <EmptyState
              icon={<IconAlert size={56} />}
              title={t("library.loadFailedTitle")}
              body={t("library.loadFailedBody")}
              primary={{ label: t("library.loadFailedRetry"), onClick: () => void reload() }}
            />
          ) : emptyState ? (
            <EmptyState
              icon={<IconMonitor size={56} />}
              title={t("library.emptyTitle")}
              body={t("library.emptyBody")}
              extra={
                <div className="flex flex-col items-center gap-3">
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <GetHelp variant="hero" />
                    <BoundaryConnect variant="hero" acceptDeepLinks={false} />
                    {/* The inbox is the third way in and has no hero size of
                        its own. It stays here rather than in the sidebar so
                        the empty window still offers one set of actions. */}
                    <InboxDialog />
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-secondary">
                    <button
                      type="button"
                      className="underline hover:text-primary"
                      onClick={() => void startScan().catch((err: unknown) => push("danger", describeError(err)))}
                    >
                      {t("library.findOnNetwork")}
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      className="underline hover:text-primary"
                      onClick={() => setHostDialog(draftFromHost(null))}
                    >
                      {t("library.addComputerManually")}
                    </button>
                  </div>
                </div>
              }
            />
          ) : (
            <>
              {selection.kind !== "nearby" ? (
                visibleHosts.length === 0 && search.trim() ? (
                  <EmptyState
                    title={t("library.noMatch", { search: search.trim() })}
                    primary={{
                      label: t("library.addAsHost", { search: search.trim() }),
                      onClick: () =>
                        setHostDialog(draftFromHost(null, { address: search.trim(), friendlyName: search.trim() })),
                    }}
                  />
                ) : settings.libraryView === "grid" ? (
                  <div className={gridClass} style={gridCap(visibleHosts.length, settings.compact)}>
                    {visibleHosts.map((h) => (
                      <HostTile
                        key={h.id}
                        host={h}
                        selected={selectedIds.has(h.id)}
                        showProtocol={showProtocol}
                        onConnect={() => connectHost(h)}
                        onEdit={() => editHost(h)}
                        onWake={() =>
                          void wakeHost(h.id).catch((err: unknown) =>
                            push(
                              "danger",
                              t("library.wakeFailed", {
                                name: h.friendlyName,
                                reason: describeError(err),
                              }),
                            ),
                          )
                        }
                        onContextMenu={(e) => {
                          e.preventDefault();
                          openCtxMenu(e, h);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <HostListView
                    hosts={visibleHosts}
                    groups={groups}
                    tags={tags}
                    selectedIds={selectedIds}
                    showProtocol={showProtocol}
                    onConnect={connectHost}
                    onContextMenu={(e, h) => {
                      e.preventDefault();
                      openCtxMenu(e, h);
                    }}
                  />
                )
              ) : null}

              {showNearbyBand ? (
                <section className="mt-6" aria-label={t("library.nearbyHeading")}>
                  <h2 className="mb-3 text-2xs font-semibold uppercase tracking-wider text-tertiary">
                    {t("library.nearbyHeading")}
                  </h2>
                  <div className={gridClass} style={gridCap(unsavedDiscovered.length, settings.compact)}>
                    {unsavedDiscovered.map((d) => (
                      <DiscoveredTile
                        key={d.id}
                        host={d}
                        onAdd={() => saveDiscovered(d)}
                        onEdit={() => addDiscovered(d)}
                        onConnect={() => {
                          // The same path a quick connect takes, so the
                          // address is remembered in the recents list like
                          // every other ad-hoc connection.
                          connectAdHocResolved(d.protocol ?? "vnc", d.address, d.port);
                          rememberQuickConnect(
                            formatTarget(d.protocol ?? "vnc", d.address, d.port),
                          );
                        }}
                      />
                    ))}
                  </div>
                </section>
              ) : selection.kind === "nearby" && unsavedDiscovered.length === 0 ? (
                <EmptyState
                  icon={<IconZap size={48} />}
                  title={t("library.nothingDiscovered")}
                  body={t("library.nothingDiscoveredBody")}
                  primary={{ label: t("library.scanThisNetwork"), onClick: () => void startScan().catch((err: unknown) => push("danger", describeError(err))) }}
                  secondary={{ label: t("library.addManually"), onClick: () => setHostDialog(draftFromHost(null)) }}
                />
              ) : null}
            </>
          )}
        </main>

        {/* Two or more only: with a single host selected the bar is noise, and
            everything on it is already on that host's own tile or its
            right-click menu. */}
        {selectedIds.size > 1 ? (
          <SelectionBar
            count={selectedIds.size}
            groups={groups}
            tags={tags}
            onMoveToGroup={(gid) =>
              dropOnTarget([...selectedIds], gid === null ? { kind: "ungroup" } : { kind: "group", id: gid })
            }
            onAddTag={(tid) => dropOnTarget([...selectedIds], { kind: "tag", id: tid })}
            onClear={clearSelection}
          />
        ) : null}
      </div>

      {/* Overlays */}
      {marquee ? (
        <div
          className="pointer-events-none fixed z-40 rounded-xs border border-accent bg-accent/15"
          style={{
            left: marquee.left,
            top: marquee.top,
            width: marquee.right - marquee.left,
            height: marquee.bottom - marquee.top,
          }}
        />
      ) : null}
      {/* The dragged stack follows the pointer. `pointer-events: none` is not
          decoration: the drop target is found with elementFromPoint, and a
          ghost that could be hit would always be the answer. */}
      {drag ? (
        <div
          className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-pill border border-subtle bg-raised px-2.5 py-1 text-xs font-medium text-primary shadow-(--shadow-pop)"
          style={{ left: drag.x + 14, top: drag.y + 14 }}
        >
          <IconMonitor size={13} className="text-tertiary" />
          {drag.ids.length === 1 ? hostName(drag.ids[0]) : t("library.hostsCount", { count: drag.ids.length })}
        </div>
      ) : null}
      {ctxMenu ? (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={
            selectedIds.size > 1 && selectedIds.has(ctxMenu.host.id)
              ? multiMenuItems([...selectedIds])
              : menuItemsFor(ctxMenu.host)
          }
          onClose={() => setCtxMenu(null)}
        />
      ) : null}
      {groupMenu ? (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          items={groupMenuItems(groupMenu.group)}
          onClose={() => setGroupMenu(null)}
        />
      ) : null}
      {paletteOpen ? (
        <CommandPalette
          hosts={hosts}
          actions={paletteActions}
          onConnect={connectHost}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
      {hostDialog ? (
        <HostDialog
          draft={hostDialog}
          groups={groups}
          tags={tags}
          onSave={saveDraft}
          onClose={() => setHostDialog(null)}
        />
      ) : null}
      {namePrompt ? (
        <NamePromptDialog
          kind={namePrompt}
          onSubmit={(name, color) => {
            const kind = namePrompt;
            const created = kind === "group" ? saveGroup({ name }) : saveTag({ name, color });
            // A failure here used to be invisible: the dialog closed, nothing
            // appeared in the sidebar, and the only trace was a console
            // warning nobody sees in a packaged app.
            void created.then(
              () =>
                push(
                  "success",
                  kind === "group"
                    ? t("library.groupCreated", { name })
                    : t("library.tagCreated", { name }),
                ),
              (err: unknown) =>
                push(
                  "danger",
                  kind === "group"
                    ? t("library.groupCreateFailed", { reason: String(err) })
                    : t("library.tagCreateFailed", { reason: String(err) }),
                ),
            );
            setNamePrompt(null);
          }}
          onClose={() => setNamePrompt(null)}
        />
      ) : null}
      {deleteAsk ? (
        <DeleteHostsDialog
          hosts={deleteAsk}
          onCancel={() => setDeleteAsk(null)}
          onConfirm={() => {
            // The question is closed before the work starts: the dialog is the
            // question, and the toast is the answer.
            const doomed = deleteAsk;
            setDeleteAsk(null);
            void deleteHosts(doomed);
          }}
        />
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------- selection bar

/**
 * What to do with the hosts that are selected, without dragging them anywhere.
 *
 * The drag onto the sidebar is the quick route, but it is invisible until you
 * try it, and it is awkward with a trackpad on a long list. This bar states
 * plainly what is selected and offers the same two writes.
 *
 * It floats over the bottom of the grid rather than sitting above it. In the
 * flow it would appear on the first click of a Shift-range and push every tile
 * down by its own height, so the second click would land on the wrong row.
 * Bottom RIGHT, because the toast shelf owns bottom centre.
 */
function SelectionBar({
  count,
  groups,
  tags,
  onMoveToGroup,
  onAddTag,
  onClear,
}: {
  count: number;
  groups: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  onMoveToGroup: (groupId: string | null) => void;
  onAddTag: (tagId: string) => void;
  onClear: () => void;
}): ReactNode {
  const t = useT();
  return (
    <div
      className="fade-in absolute bottom-4 right-4 z-30 flex max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-md border border-strong bg-raised/95 px-3 py-2 text-sm shadow-(--shadow-pop) backdrop-blur-sm"
    >
      {/* Only the count is a live region. Wrapping the selects in one would
          have a screen reader re-read every control each time the count
          changed, which during a marquee is constantly. */}
      <span className="font-medium text-primary" role="status">
        {t("library.selectedCount", { count })}
      </span>
      <span className="hidden text-xs text-tertiary lg:inline">
        {t("library.dragHint")}
      </span>
      <label className="flex items-center gap-1.5 text-xs text-secondary">
        {t("host.group")}
        <Select
          wrapperClassName="!inline-block"
          className="!w-auto !py-1 text-xs"
          aria-label={t("library.moveToGroupAria")}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) onMoveToGroup(v === "__none__" ? null : v);
            e.target.value = "";
          }}
        >
          <option value="">{t("library.moveTo")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="__none__">{t("host.noGroup")}</option>
        </Select>
      </label>
      <label className="flex items-center gap-1.5 text-xs text-secondary">
        {t("host.tags")}
        <Select
          wrapperClassName="!inline-block"
          className="!w-auto !py-1 text-xs"
          aria-label={t("library.addTagAria")}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v) onAddTag(v);
            e.target.value = "";
          }}
        >
          <option value="">{t("library.addTag")}</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </Select>
      </label>
      <button type="button" className="btn-secondary ms-auto !py-1 !text-xs" onClick={onClear}>
        {t("library.clearSelection")}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ list view

function HostListView({
  hosts,
  groups,
  tags,
  selectedIds,
  onConnect,
  onContextMenu,
  showProtocol,
}: {
  hosts: HostProfile[];
  groups: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  selectedIds: ReadonlySet<string>;
  onConnect: (h: HostProfile) => void;
  onContextMenu: (e: React.MouseEvent, h: HostProfile) => void;
  /** The library holds more than one protocol, so the column earns its width. */
  showProtocol?: boolean;
}): ReactNode {
  const { forKey } = useSessions();
  const { t, lang } = useI18n();
  return (
    <div className="select-none overflow-x-auto rounded-md border border-subtle bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-subtle text-start text-xs text-tertiary">
            <th className="px-3 py-2 font-medium">{t("host.name")}</th>
            <th className="px-3 py-2 font-medium">{t("host.address")}</th>
            <th className="px-3 py-2 font-medium">{t("host.group")}</th>
            <th className="px-3 py-2 font-medium">{t("host.tags")}</th>
            {showProtocol ? <th className="px-3 py-2 font-medium">{t("library.colProtocol")}</th> : null}
            <th className="px-3 py-2 font-medium">{t("host.os")}</th>
            <th className="px-3 py-2 font-medium">{t("library.sortLastConnected")}</th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => (
            <tr
              key={h.id}
              data-host-id={h.id}
              tabIndex={0}
              /*
                No `aria-selected` on this row.

                `aria-selected` is only valid inside a grid or a treegrid, and
                this is a plain table: the attribute meant nothing to a screen
                reader and meant something FALSE to a validator. The table
                keeps its table semantics rather than pretending to be a grid
                it does not implement the keyboard model of, and the state is
                carried by the row's own name instead, so a selected row says
                so. `aria-current` is the state that IS valid on a row.
              */
              aria-current={selectedIds.has(h.id) ? "true" : undefined}
              className={classNames(
                "cursor-default border-b border-subtle last:border-b-0",
                selectedIds.has(h.id) ? "bg-accent/12" : "hover:bg-inset/60",
              )}
              onDoubleClick={() => onConnect(h)}
              onContextMenu={(e) => onContextMenu(e, h)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onConnect(h);
              }}
            >
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <span
                    className={classNames("h-2 w-2 rounded-full", h.online ? "bg-success" : "bg-tertiary/60")}
                    role="img"
                    aria-label={h.online ? t("library.online") : t("library.offline")}
                  />
                  <span className="font-medium text-primary">{h.friendlyName}</span>
                  {selectedIds.has(h.id) ? (
                    <span className="sr-only"> {t("library.rowSelected")}</span>
                  ) : null}
                </span>
              </td>
              <td className="mono px-3 py-2 text-secondary">
                {addressLabel(h)}
                <RowBandwidth bandwidth={forKey(h.id).bandwidth} />
              </td>
              <td className="px-3 py-2 text-secondary">
                {groups.find((g) => g.id === h.groupId)?.name ?? "-"}
              </td>
              <td className="px-3 py-2">
                <span className="flex gap-1">
                  {h.tags.map((tid) => {
                    const tag = tags.find((x) => x.id === tid);
                    return tag ? (
                      <span
                        key={tid}
                        className="rounded-pill px-1.5 py-px text-2xs font-medium text-white"
                        style={{ background: tag.color }}
                      >
                        {tag.name}
                      </span>
                    ) : null;
                  })}
                </span>
              </td>
              {showProtocol ? (
                <td className="px-3 py-2 text-secondary">{protocolLabel(h.protocol)}</td>
              ) : null}
              <td className="px-3 py-2 text-secondary">{osLabel(h.osHint)}</td>
              <td className="px-3 py-2 text-secondary">{timeAgo(h.lastConnected, t, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Compact `↓/↑` for a row with fresh session stats (no sparkline in the table). */
function RowBandwidth({
  bandwidth,
}: {
  bandwidth: { rx: number; tx: number } | null;
}): ReactNode {
  if (!bandwidth) return null;
  return (
    <span className="ms-2 whitespace-nowrap text-2xs text-tertiary [font-variant-numeric:tabular-nums]">
      ↓ {formatBps(bandwidth.rx)} ↑ {formatBps(bandwidth.tx)}
    </span>
  );
}

// ------------------------------------------------------------- name prompt

const TAG_COLORS = ["#e5544b", "#e5a53a", "#34c26b", "#4f8ef7", "#8a63e8", "#e560a8"];

function NamePromptDialog({
  kind,
  onSubmit,
  onClose,
}: {
  kind: "group" | "tag";
  onSubmit: (name: string, color: string) => void;
  onClose: () => void;
}): ReactNode {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[3]);
  const t = useT();
  return (
    <Dialog
      title={kind === "group" ? t("library.newGroup") : t("library.newTag")}
      onClose={onClose}
      width={400}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim(), color);
        }}
      >
        <input
          data-autofocus
          className="field"
          placeholder={kind === "group" ? t("library.groupPlaceholder") : t("library.tagPlaceholder")}
          aria-label={kind === "group" ? t("library.groupNameAria") : t("library.tagNameAria")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {kind === "tag" ? (
          <div className="flex gap-2" role="radiogroup" aria-label={t("library.tagColorAria")}>
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={t("library.colorAria", { color: c })}
                className={classNames(
                  "h-6 w-6 rounded-full border-2",
                  color === c ? "border-primary" : "border-transparent",
                )}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {t("host.cancel")}
          </button>
          <button type="submit" className="btn-primary" disabled={!name.trim()}>
            {t("library.create")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
