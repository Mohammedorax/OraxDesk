import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { blankHostProfile, type HostGroup, type HostProfile, type HostTag } from "../lib/types";
import { inTauri, mustInvoke, safeInvoke, safeListen } from "../lib/tauri";
import {
  MOCK_GROUPS,
  MOCK_HOSTS,
  MOCK_TAGS,
  MOCK_THUMBNAIL_EVENT,
  mockThumbnail,
  useMockData,
  withMockThumbnails,
  type ThumbnailUpdate,
} from "../lib/mock";

/**
 * Broadcast by the shell after `capture_thumbnail` writes a PNG (see
 * `src-tauri/src/thumbnail.rs`). The session that captured it lives in a
 * different window, so this is the only way the Library hears about it.
 */
const THUMBNAIL_EVENT = "library://thumbnail";

/**
 * Where the favourites live: local storage, next to the rest of the
 * interface's own state, because they are the interface's own state and not
 * a column the store knows about.
 */
const FAVORITES_KEY = "deskvnc.library.favorites";

function readFavoriteIds(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    // Blocked or corrupt storage: no favourites, and nothing is lost that
    // the user could not have written themselves.
    return new Set();
  }
}

function writeFavoriteIds(ids: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...ids]));
  } catch {
    // Blocked storage: the flag lasts until the window closes.
  }
}

/** Put the client-side favourite flag back onto the profiles. */
function applyFavorites(list: HostProfile[], ids: Set<string>): HostProfile[] {
  return list.map((h) => ({ ...h, favorite: ids.has(h.id) }));
}

/**
 * Session lifecycle broadcast (`src-tauri/src/commands/session.rs`). The
 * Library only cares about one of its payloads: `host-adopted`, sent when a
 * quick connect that ticked "remember this password" gained a host profile,
 * because the password had nowhere else to live. That host was created in
 * another window's session, so this is the only way the tile appears without
 * the user reopening the Library.
 */
const SESSIONS_EVENT = "sessions://event";

interface SessionsEvent {
  type?: string;
}

interface HostsContextValue {
  hosts: HostProfile[];
  groups: HostGroup[];
  tags: HostTag[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** A full reload, tile pictures included. */
  reload: () => Promise<void>;
  saveHost: (host: Partial<HostProfile> & { id?: string }) => Promise<HostProfile | null>;
  /** Add or remove a host from the favourites. Client-side only. */
  toggleFavorite: (id: string) => void;
  deleteHost: (id: string) => Promise<void>;
  saveGroup: (group: Partial<HostGroup> & { name: string }) => Promise<HostGroup>;
  deleteGroup: (id: string) => Promise<void>;
  saveTag: (tag: Partial<HostTag> & { name: string }) => Promise<HostTag>;
  deleteTag: (id: string) => Promise<void>;
  setHostTags: (hostId: string, tagIds: string[]) => Promise<void>;
  /** Move a set of hosts into a group, or out of every group with `null`. */
  setHostsGroup: (hostIds: string[], groupId: string | null) => Promise<void>;
  /** Add one tag to a set of hosts, leaving their other tags alone. */
  addTagToHosts: (hostIds: string[], tagId: string) => Promise<void>;
  removeTagFromHosts: (hostIds: string[], tagId: string) => Promise<void>;
  savePassword: (hostId: string, password: string) => Promise<void>;
  /**
   * Save the SSH passphrase/password used by the Files panel and the SSH
   * tunnel. `save_password` merges per field on the Rust side, so this never
   * disturbs a stored VNC password (nor the reverse).
   */
  saveSshPassphrase: (hostId: string, passphrase: string) => Promise<void>;
  /**
   * The RDP identity: user name, domain and password together.
   *
   * One call rather than three because the three are one credential, and
   * because `save_password` merges per field on the Rust side, so writing
   * them never disturbs a VNC password or an SSH passphrase on the same host.
   */
  saveRdpCredentials: (
    hostId: string,
    creds: { user: string; domain: string; password: string },
  ) => Promise<void>;
  deletePassword: (hostId: string) => Promise<void>;
  wakeHost: (hostId: string) => Promise<void>;
  /**
   * blob: URL for a thumbnail, or null.
   *
   * The key is a host id for a saved profile and `discovered:<address>:<port>`
   * for a machine connected to straight from the Nearby list, the store keys
   * the PNG file the same way, and neither side consults the `hosts` table.
   */
  thumbnailUrl: (key: string) => string | null;
  requestThumbnail: (key: string) => void;
  /** Drop one cached thumbnail and re-read it from the store. */
  refreshThumbnail: (key: string) => void;
}

const HostsContext = createContext<HostsContextValue | null>(null);

/** Mock thumbnails are `data:` URLs; only the real PNG blobs need revoking. */
function revokeThumb(url: string | null | undefined): void {
  if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
}

export function HostsProvider({ children }: { children: ReactNode }): ReactNode {
  const mock = useMockData();
  const [hosts, setHosts] = useState<HostProfile[]>([]);
  const [groups, setGroups] = useState<HostGroup[]>([]);
  const [tags, setTags] = useState<HostTag[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * Tile images live in React state, NOT a ref: a ref plus a bump counter left
   * outside the context value never reaches the tiles, because re-rendering
   * this provider with an unchanged `children` element and an unchanged
   * context value is a React bailout, the fetched thumbnail was cached and
   * then silently never painted.
   *
   * A host present as a key has been resolved (`null` = "no thumbnail");
   * absent means "not fetched yet".
   */
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  /** The same map, for the code that has to read it without re-rendering. */
  const thumbsRef = useRef(thumbs);
  thumbsRef.current = thumbs;
  /** Hosts already resolved or in flight, keeps `requestThumbnail` stable. */
  const thumbKnown = useRef(new Set<string>());
  const thumbPending = useRef(new Set<string>());
  /** Bumped on invalidation so a slow in-flight fetch cannot overwrite a newer one. */
  const thumbGeneration = useRef(new Map<string, number>());
  /** False once this provider is gone: a late fetch must not leak a blob URL. */
  const mounted = useRef(true);

  /**
   * Store one resolved thumbnail, revoking whatever it replaces.
   *
   * The revocation happens OUTSIDE the state updater. An updater is meant to
   * be pure, and React may call it more than once, so revoking a blob URL
   * inside one meant the URL could be revoked while the image it belonged to
   * was still on screen.
   */
  const putThumb = useCallback((key: string, url: string | null): void => {
    const previous = thumbsRef.current[key];
    setThumbs((prev) => ({ ...prev, [key]: url }));
    if (previous && previous !== url) revokeThumb(previous);
  }, []);

  const requestThumbnail = useCallback(
    (key: string): void => {
      if (!key || thumbKnown.current.has(key) || thumbPending.current.has(key)) return;
      thumbKnown.current.add(key);
      if (!inTauri()) {
        // Browser dev: whatever the mock session captured, if anything.
        putThumb(key, mockThumbnail(key)?.url ?? null);
        return;
      }
      const generation = thumbGeneration.current.get(key) ?? 0;
      thumbPending.current.add(key);
      // NB: `get_thumbnail` reads `thumbnails/<key>.png` directly, it does not
      // look the key up in the hosts table, which is what lets a discovered
      // endpoint have a tile image without ever being saved.
      void safeInvoke<ArrayBuffer | number[] | null>("get_thumbnail", { hostId: key }, null).then(
        (data) => {
          thumbPending.current.delete(key);
          let url: string | null = null;
          if (data) {
            const bytes =
              data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
            if (bytes.byteLength > 0) {
              url = URL.createObjectURL(
                new Blob([bytes.buffer as ArrayBuffer], { type: "image/png" }),
              );
            }
          }
          // A newer capture landed while this read was in flight, or the
          // window went away, either way the blob must not survive us.
          if (!mounted.current || (thumbGeneration.current.get(key) ?? 0) !== generation) {
            revokeThumb(url);
            return;
          }
          putThumb(key, url);
        },
      );
    },
    [putThumb],
  );

  /** Drop one cached thumbnail and read it back from the store. */
  const refreshThumbnail = useCallback(
    (key: string): void => {
      thumbGeneration.current.set(key, (thumbGeneration.current.get(key) ?? 0) + 1);
      thumbKnown.current.delete(key);
      thumbPending.current.delete(key);
      requestThumbnail(key);
    },
    [requestThumbnail],
  );

  /** Forget a thumbnail entirely (its host is gone), releasing the blob. */
  const forgetThumbnail = useCallback((key: string): void => {
    thumbGeneration.current.set(key, (thumbGeneration.current.get(key) ?? 0) + 1);
    thumbKnown.current.delete(key);
    thumbPending.current.delete(key);
    setThumbs((prev) => {
      if (!(key in prev)) return prev;
      revokeThumb(prev[key]);
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /**
   * Re-read every thumbnail we already hold, keeping the current image on
   * screen until its replacement arrives.
   *
   * This deliberately does NOT clear the cache first. Dropping the blob URLs
   * and waiting for the tiles to ask again does not work: a tile only asks
   * from an effect keyed on the host, and reloading the host list produces the
   * same key, so React never re-runs it, and every tile in the library went
   * blank until the window was reopened. That is the "thumbnails aren't
   * remembered" report: the picture survived on disk, the screen did not.
   */
  const revalidateThumbnails = useCallback((): void => {
    for (const key of [...thumbKnown.current]) refreshThumbnail(key);
  }, [refreshThumbnail]);

  /**
   * Favourites are a client-side flag: the store has no `favorite` column.
   *
   * They used to be carried in the `save_host` payload, where the backend
   * dropped them, and then erased by the `refresh()` that followed, so the
   * flag only ever existed in the array between one write and the next read
   * of it. In the shipped app the Favourites count in the sidebar and the
   * Favourites filter were therefore always empty.
   *
   * They live here instead, keyed by host id and kept in local storage, and
   * are merged back onto the profiles every time the list is read.
   */
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(readFavoriteIds);
  const favoriteIdsRef = useRef(favoriteIds);
  favoriteIdsRef.current = favoriteIds;

  /**
   * Bumped on every read of the library, so a read that was issued first but
   * lands last cannot overwrite a newer one.
   *
   * `refresh` is called after every write, and each call issues three
   * `list_*` commands. Two of those in flight at once could settle in the
   * wrong order, and the library would then show a snapshot taken before the
   * last write landed.
   */
  const libraryGeneration = useRef(0);

  /**
   * Read the library and put it on screen.
   *
   * `revalidate` re-reads every thumbnail, which is what a window that has
   * just opened needs and what a write does not: the tile pictures do not
   * change when a host is renamed, and re-reading all of them meant that
   * saving one host read the PNG of every host in the library.
   */
  const readLibrary = useCallback(
    async (revalidate: boolean): Promise<void> => {
      if (revalidate) revalidateThumbnails();
      if (mock) {
        setHosts(withMockThumbnails(MOCK_HOSTS));
        setGroups(MOCK_GROUPS);
        setTags(MOCK_TAGS);
        setLoading(false);
        return;
      }
      const generation = ++libraryGeneration.current;
      const [h, g, t] = await Promise.all([
        safeInvoke<HostProfile[]>("list_hosts", undefined, []),
        safeInvoke<HostGroup[]>("list_groups", undefined, []),
        safeInvoke<HostTag[]>("list_tags", undefined, []),
      ]);
      // A read that lost the race is not the answer any more.
      if (generation !== libraryGeneration.current) return;
      // A read that failed must not empty the library. The old code took the
      // `[]` fallback at face value, so a single failed `list_hosts` replaced
      // every host with nothing and the user was shown an empty library, with
      // no way to tell that from having deleted them all.
      setHosts((prev) => (Array.isArray(h) ? applyFavorites(h, favoriteIdsRef.current) : prev));
      setGroups((prev) => (Array.isArray(g) ? g : prev));
      setTags((prev) => (Array.isArray(t) ? t : prev));
      setLoading(false);
    },
    [mock, revalidateThumbnails],
  );

  /** The library as it is now. A write does not change any picture. */
  const refresh = useCallback(async (): Promise<void> => {
    await readLibrary(false);
  }, [readLibrary]);

  /** A full reload, pictures included. For a window that has just opened. */
  const reload = useCallback(async (): Promise<void> => {
    await readLibrary(true);
  }, [readLibrary]);

  useEffect(() => {
    // The first read of a window re-reads the pictures too, because the
    // tiles have not asked for them yet.
    void reload();
  }, [reload]);

  /** Latest host list, for callbacks that must not change identity with it. */
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;

  const saveHost = useCallback(
    async (host: Partial<HostProfile> & { id?: string }): Promise<HostProfile | null> => {
      // `save_host` deserializes a COMPLETE vnc_store::HostProfile and upserts
      // every column, so a partial patch would not merely be rejected, the
      // missing fields would be written as blanks. Fill in from the profile
      // we already hold (the edit dialog knows nothing about `thumbnailAt`,
      // `lastConnected` or `connectCount`; renaming a host must not erase its
      // picture and its history), falling back to a blank for a new host.
      const existing = host.id ? hostsRef.current.find((h) => h.id === host.id) : undefined;
      const full: HostProfile = {
        ...(existing ?? blankHostProfile()),
        ...host,
        // The id doubles as the keyring account key on the Rust side, so a
        // new host gets a real uuid rather than a timestamp.
        id: host.id || crypto.randomUUID(),
      };
      if (mock || !inTauri()) {
        setHosts((prev) => {
          const i = prev.findIndex((p) => p.id === full.id);
          if (i >= 0) {
            const next = prev.slice();
            next[i] = { ...prev[i], ...full };
            return next;
          }
          return [...prev, full];
        });
        return full;
      }
      // UI-local fields are not columns on the Rust struct; drop them so the
      // payload is exactly the backend contract.
      const { favorite: _favorite, online: _online, ...profile } = full;
      // `mustInvoke`, not `safeInvoke`: a swallowed failure used to reach the
      // caller as `null`, which the editor read as "the host has no id yet",
      // skipped the password write entirely, and then told the user the host
      // had been added. The host was not in the library and the password the
      // user had just typed was gone.
      const saved = await mustInvoke<HostProfile>("save_host", { profile });
      await refresh();
      return saved;
    },
    [mock, refresh],
  );

  /**
   * Add or remove a host from the favourites.
   *
   * The flag has no column in the store, so it is kept here and in local
   * storage, and merged back onto the profiles whenever the list is read.
   */
  const toggleFavorite = useCallback((id: string): void => {
    // The new set is computed here rather than inside the state updater: an
    // updater is meant to be pure, and React may call it more than once, so
    // writing to storage from inside one would write more than once.
    const next = new Set(favoriteIdsRef.current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    writeFavoriteIds(next);
    favoriteIdsRef.current = next;
    setFavoriteIds(next);
    setHosts((prev) =>
      prev.map((h) => (h.id === id ? { ...h, favorite: next.has(id) } : h)),
    );
  }, []);

  const deleteHost = useCallback(
    async (id: string): Promise<void> => {
      // `delete_host` also removes the PNG, so drop the cached blob rather
      // than let it linger for a host that no longer exists.
      forgetThumbnail(id);
      if (mock) {
        setHosts((prev) => prev.filter((h) => h.id !== id));
        return;
      }
      // `mustInvoke`, not `safeInvoke`: a delete that failed has to be
      // reported, because the caller tells the user the host is gone and
      // offers an Undo that would restore a row that never left.
      await mustInvoke("delete_host", { hostId: id });
      await refresh();
    },
    [mock, refresh, forgetThumbnail],
  );

  /** Latest group/tag lists, for the `sort` of a group being created. */
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const saveGroup = useCallback(
    async (group: Partial<HostGroup> & { name: string }): Promise<HostGroup> => {
      // `save_group` deserializes a COMPLETE vnc_store::Group: `id`, `name`,
      // `parentId` and `sort` are all required, and serde rejects the whole
      // payload when one is missing. Sending `{ name }` alone is why a new
      // group silently never appeared: the command failed on the Rust side
      // and the reply was thrown away.
      const parentId = group.parentId ?? null;
      const siblings = groupsRef.current.filter((g) => g.parentId === parentId);
      const full: HostGroup = {
        id: group.id || crypto.randomUUID(),
        name: group.name,
        parentId,
        sort: group.sort ?? siblings.reduce((max, g) => Math.max(max, g.sort + 1), 0),
      };
      if (mock || !inTauri()) {
        setGroups((prev) => {
          const i = prev.findIndex((g) => g.id === full.id);
          if (i < 0) return [...prev, full];
          const next = prev.slice();
          next[i] = full;
          return next;
        });
        return full;
      }
      // mustInvoke, not safeInvoke: a group the user asked for and did not get
      // has to be reported, not swallowed into a console warning.
      await mustInvoke("save_group", { group: full });
      await refresh();
      return full;
    },
    [mock, refresh],
  );

  const deleteGroup = useCallback(
    async (id: string): Promise<void> => {
      // The browser-dev branch matters here as much as in `saveGroup`: a group
      // created in the dev build has to be deletable there too, or it is
      // stuck on screen for the rest of the session.
      if (mock || !inTauri()) {
        setGroups((prev) => prev.filter((g) => g.id !== id));
        setHosts((prev) => prev.map((h) => (h.groupId === id ? { ...h, groupId: null } : h)));
        return;
      }
      await mustInvoke("delete_group", { groupId: id });
      await refresh();
    },
    [mock, refresh],
  );

  const saveTag = useCallback(
    async (tag: Partial<HostTag> & { name: string }): Promise<HostTag> => {
      // Same contract as save_group above: vnc_store::Tag needs `id`, `name`
      // and `color` together, so a `{ name, color }` payload never created
      // anything.
      const full: HostTag = {
        id: tag.id || crypto.randomUUID(),
        name: tag.name,
        color: tag.color ?? "#4f8ef7",
      };
      if (mock || !inTauri()) {
        setTags((prev) => {
          const i = prev.findIndex((t) => t.id === full.id);
          if (i < 0) return [...prev, full];
          const next = prev.slice();
          next[i] = full;
          return next;
        });
        return full;
      }
      await mustInvoke("save_tag", { tag: full });
      await refresh();
      return full;
    },
    [mock, refresh],
  );

  const deleteTag = useCallback(
    async (id: string): Promise<void> => {
      if (mock || !inTauri()) {
        setTags((prev) => prev.filter((t) => t.id !== id));
        setHosts((prev) => prev.map((h) => ({ ...h, tags: h.tags.filter((t) => t !== id) })));
        return;
      }
      await mustInvoke("delete_tag", { tagId: id });
      await refresh();
    },
    [mock, refresh],
  );

  const setHostTags = useCallback(
    async (hostId: string, tagIds: string[]): Promise<void> => {
      if (mock || !inTauri()) {
        setHosts((prev) => prev.map((h) => (h.id === hostId ? { ...h, tags: tagIds } : h)));
        return;
      }
      await mustInvoke("set_host_tags", { hostId, tagIds });
      await refresh();
    },
    [mock, refresh],
  );

  /**
   * Move a selection of hosts into a group in one call.
   *
   * Deliberately not a loop over `saveHost`: that upserts every column of a
   * whole profile per host and re-reads the library each time, so a ten-host
   * drag would be ten full writes racing ten refreshes.
   */
  const setHostsGroup = useCallback(
    async (hostIds: string[], groupId: string | null): Promise<void> => {
      if (hostIds.length === 0) return;
      const ids = new Set(hostIds);
      if (mock || !inTauri()) {
        setHosts((prev) => prev.map((h) => (ids.has(h.id) ? { ...h, groupId } : h)));
        return;
      }
      await mustInvoke("set_hosts_group", { hostIds, groupId });
      await refresh();
    },
    [mock, refresh],
  );

  /**
   * Add one tag across a selection, leaving each host's other tags alone.
   * `set_host_tags` replaces a host's whole set, which is the wrong shape for
   * "drop these five onto prod": it would strip every other tag they carry.
   */
  const addTagToHosts = useCallback(
    async (hostIds: string[], tagId: string): Promise<void> => {
      if (hostIds.length === 0) return;
      const ids = new Set(hostIds);
      if (mock || !inTauri()) {
        setHosts((prev) =>
          prev.map((h) =>
            ids.has(h.id) && !h.tags.includes(tagId) ? { ...h, tags: [...h.tags, tagId] } : h,
          ),
        );
        return;
      }
      await mustInvoke("add_tag_to_hosts", { hostIds, tagId });
      await refresh();
    },
    [mock, refresh],
  );

  const removeTagFromHosts = useCallback(
    async (hostIds: string[], tagId: string): Promise<void> => {
      if (hostIds.length === 0) return;
      const ids = new Set(hostIds);
      if (mock || !inTauri()) {
        setHosts((prev) =>
          prev.map((h) => (ids.has(h.id) ? { ...h, tags: h.tags.filter((t) => t !== tagId) } : h)),
        );
        return;
      }
      await mustInvoke("remove_tag_from_hosts", { hostIds, tagId });
      await refresh();
    },
    [mock, refresh],
  );

  const savePassword = useCallback(
    async (hostId: string, password: string): Promise<void> => {
      // `mustInvoke`, not `safeInvoke`: the keychain can refuse (locked,
      // unavailable), and the flag below used to be flipped anyway, so the
      // tile showed a key for a secret that was never stored and the next
      // connect asked for a password the user believed was saved.
      await mustInvoke("save_password", { hostId, creds: { vncPassword: password } });
      setHosts((prev) => prev.map((h) => (h.id === hostId ? { ...h, hasPassword: true } : h)));
    },
    [],
  );

  const saveSshPassphrase = useCallback(
    async (hostId: string, passphrase: string): Promise<void> => {
      // Deliberately does NOT flip `hasPassword`: that flag (and the key
      // icon) means "a VNC password is saved", and the connect flow reads it
      // to decide whether to expect a prompt.
      await mustInvoke("save_password", { hostId, creds: { sshPassphrase: passphrase } });
    },
    [],
  );

  const saveRdpCredentials = useCallback(
    async (
      hostId: string,
      creds: { user: string; domain: string; password: string },
    ): Promise<void> => {
      // Only non-empty fields are sent: `save_password` fills in rather than
      // overwrites, so an empty box in the editor means "keep what is
      // stored" exactly as the password box already does.
      const payload: Record<string, string> = {};
      if (creds.user.trim()) payload.rdpUser = creds.user.trim();
      if (creds.domain.trim()) payload.rdpDomain = creds.domain.trim();
      if (creds.password) payload.rdpPassword = creds.password;
      if (Object.keys(payload).length === 0) return;
      await mustInvoke("save_password", { hostId, creds: payload });
      if (payload.rdpPassword) {
        setHosts((prev) => prev.map((h) => (h.id === hostId ? { ...h, hasPassword: true } : h)));
      }
    },
    [],
  );

  const deletePassword = useCallback(
    async (hostId: string): Promise<void> => {
      await mustInvoke("delete_password", { hostId });
      setHosts((prev) => prev.map((h) => (h.id === hostId ? { ...h, hasPassword: false } : h)));
    },
    [],
  );

  const wakeHost = useCallback(async (hostId: string): Promise<void> => {
    // `mustInvoke`: the Rust side refuses when the host has no MAC address
    // stored, and that refusal used to be swallowed, so the caller said
    // "Magic packet sent" for a packet that was never sent.
    await mustInvoke("wake_host", { profileId: hostId });
  }, []);

  const thumbnailUrl = useCallback((key: string): string | null => thumbs[key] ?? null, [thumbs]);

  /**
   * A session in another window just stored a fresh screenshot (PRD/03 §3.1:
   * on connect, and again on the way out). Without this the tile keeps showing
   * whatever it read at startup, or the colour-hash placeholder, until the
   * app is restarted.
   */
  useEffect(() => {
    const onUpdate = (ev: ThumbnailUpdate | undefined): void => {
      if (!ev || typeof ev.hostId !== "string" || !ev.hostId) return;
      // Keep the in-memory profile in step with the column the store just
      // wrote. `hostId` is a `discovered:` key for an ad-hoc session, which
      // matches no profile, the re-read below is what puts the picture on
      // that tile, and it does not care whether the host is saved.
      setHosts((prev) =>
        prev.map((h) => (h.id === ev.hostId ? { ...h, thumbnailAt: ev.capturedAt } : h)),
      );
      refreshThumbnail(ev.hostId);
    };

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void safeListen<ThumbnailUpdate>(THUMBNAIL_EVENT, onUpdate).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    // Browser dev: the mock session dispatches the same payload on the window.
    const onMock = (e: Event): void => onUpdate((e as CustomEvent<ThumbnailUpdate>).detail);
    window.addEventListener(MOCK_THUMBNAIL_EVENT, onMock);
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener(MOCK_THUMBNAIL_EVENT, onMock);
    };
  }, [refreshThumbnail]);

  /** A session just turned itself into a saved host: re-read the list. */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void safeListen<SessionsEvent>(SESSIONS_EVENT, (ev) => {
      if (cancelled || ev?.type !== "host-adopted") return;
      void refresh();
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refresh]);

  // Unmount: release every blob: URL still held.
  useEffect(() => {
    // Re-armed on mount: StrictMode's dev remount runs the cleanup below once
    // before the real mount, and a permanently false flag would then throw
    // away every thumbnail fetched afterwards.
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const url of Object.values(thumbsRef.current)) revokeThumb(url);
    };
  }, []);

  const value = useMemo(
    () => ({
      hosts, groups, tags, loading, refresh, reload, saveHost, deleteHost, saveGroup,
      deleteGroup, saveTag, deleteTag, setHostTags, setHostsGroup, addTagToHosts,
      removeTagFromHosts, savePassword, saveSshPassphrase, saveRdpCredentials, deletePassword,
      wakeHost, toggleFavorite, thumbnailUrl, requestThumbnail, refreshThumbnail,
    }),
    [
      hosts, groups, tags, loading, refresh, reload, saveHost, deleteHost, saveGroup,
      deleteGroup, saveTag, deleteTag, setHostTags, setHostsGroup, addTagToHosts,
      removeTagFromHosts, savePassword, saveSshPassphrase, saveRdpCredentials, deletePassword,
      wakeHost, toggleFavorite, thumbnailUrl, requestThumbnail, refreshThumbnail,
    ],
  );

  return <HostsContext.Provider value={value}>{children}</HostsContext.Provider>;
}

export function useHosts(): HostsContextValue {
  const ctx = useContext(HostsContext);
  if (!ctx) throw new Error("useHosts outside HostsProvider");
  return ctx;
}
