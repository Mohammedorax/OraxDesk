/**
 * QuickConnect: the always-visible address bar. Type where to go, press Enter,
 * you are connected. Nothing is saved and nothing has to be set up first.
 *
 * It is deliberately a permanent strip rather than a dialog behind a shortcut,
 * because "I just want to reach this one machine once" is the single most
 * common thing a viewer is opened for, and a feature nobody can see is a
 * feature nobody uses.
 *
 * Typing an address that a saved host already covers connects through that
 * host, so its quality, view-only and stored password still apply. Anything
 * else connects ad-hoc.
 */
import { BoundaryConnect } from "./BoundaryConnect";
import { GetHelp } from "./GetHelp";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DiscoveredHost, HostProfile, ProtocolKind } from "../lib/types";
import { DEFAULT_PORT, PROTOCOLS, hostProtocol, protocolLabel, protocolName } from "../lib/types";
import {
  addressErrorText,
  compactDeviceNumber,
  formatTarget,
  isDisplayNumber,
  parseConnectTarget,
  presetProtocol,
} from "../lib/address";
import { classNames, fuzzyMatch, modKeyLabel } from "../lib/util";
import { useI18n, type MessageKey } from "../lib/i18n";
import { enterAction, modeToggle, type QuickMode } from "../lib/quickConnect";
import { IconArrowRight, IconClock, IconMonitor, IconSearch, IconZap } from "./icons";

/** Matches the Rust side's `normalize_address`, so both agree on "same machine". */
function sameAddress(a: string, b: string): boolean {
  const norm = (s: string): string =>
    s
      .trim()
      .replace(/\.+$/, "")
      .replace(/[A-Z]/g, (c) => c.toLowerCase()); // ASCII only, as Rust does
  return norm(a) === norm(b);
}

/**
 * What a person typed is an endpoint rather than a library search.
 *
 * This is deliberately punctuation-based, not "parseConnectTarget says it is
 * valid": almost any word parses as a VNC hostname, and switching modes on
 * every letter would make the search box unusable. A colon, dot, slash or
 * at-sign, or the two OraxDesk number forms, is the intent to connect.
 */
function looksLikeAddress(value: string): boolean {
  const text = value.trim();
  return (
    /^[0-9a-fA-F]{64}$/.test(text) ||
    /^\d{9}$/.test(text.replace(/[\s.-]/g, "")) ||
    /[:/@]/.test(text) ||
    /^(vnc|rdp|ssh):\/\//i.test(text)
  );
}

/**
 * The protocol the chip flips to on a click, wrapping through `PROTOCOLS` in
 * the order the protocol picker itself uses (vnc -> rdp -> ssh -> vnc).
 *
 * A two-state flip stopped making sense once a third protocol existed:
 * "the other protocol" is only well defined between two. A cycle keeps the
 * chip a single click-to-correct button rather than opening a second
 * floating panel next to the one the suggestion list already owns below the
 * field, so the fix is the tooltip, not the control: it names the SPECIFIC
 * protocol one more click lands on, rather than leaving "the other one"
 * ambiguous among three.
 */
function nextProtocol(p: ProtocolKind): ProtocolKind {
  const i = PROTOCOLS.indexOf(p);
  return PROTOCOLS[(i + 1) % PROTOCOLS.length];
}

interface Suggestion {
  key: string;
  kind: "address" | "host" | "nearby" | "recent";
  label: string;
  sub: string;
  /** Shown as a chip on the row, so "Connect to rdp://frontdesk" and
   *  "Connect to frontdesk" are visibly different things. */
  protocol: ProtocolKind;
  /**
   * Which group of suggestions this row belongs to.
   *
   * The list used to be one flat wall of up to thirteen rows with no
   * headings, so a person who typed one character got a screen of recents
   * with no way to tell them from their own computers.
   */
  group: "typed" | "hosts" | "nearby" | "recent";
  run: () => void;
}

const MAX_HOST_SUGGESTIONS = 4;
const MAX_NEARBY_SUGGESTIONS = 3;
const MAX_RECENT_SUGGESTIONS = 5;

const GROUP_HEADINGS: Record<Suggestion["group"], MessageKey> = {
  typed: "quick.groupTyped",
  hosts: "quick.groupHosts",
  nearby: "quick.groupNearby",
  recent: "quick.groupRecent",
};

export function QuickConnect({
  hosts,
  discovered,
  recents,
  inputRef,
  onConnectHost,
  onConnectAddress,
  onRemember,
  onSearch,
  embedded = false,
  showSupport = true,
}: {
  hosts: HostProfile[];
  discovered: DiscoveredHost[];
  /** Previously quick-connected addresses, most recent first. */
  recents: string[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  onConnectHost: (host: HostProfile) => void;
  onConnectAddress: (protocol: ProtocolKind, address: string, port: number) => void;
  onRemember: (address: string) => void;
  /** In search mode this feeds the Library filter. */
  onSearch?: (value: string) => void;
  /** The header draws the field without its own border and padding. */
  embedded?: boolean;
  /** The sidebar owns the support actions when the field is in the header. */
  showSupport?: boolean;
}): ReactNode {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  /** -1 is "nothing picked yet", so Enter uses the field, not a highlighted row. */
  const [selected, setSelected] = useState(-1);
  /** Only red after the user actually tried to connect; typing is not an error. */
  const [attempted, setAttempted] = useState(false);
  const [mode, setMode] = useState<QuickMode>("search");
  const listRef = useRef<HTMLDivElement>(null);
  const searchMode = mode === "search";
  const toggle = modeToggle(mode);

  // Typing ALWAYS filters the Library, in both modes: the mode decides what
  // Enter does, never whether this field is a search box. Flipping to connect
  // mode used to clear the filter silently, and the only way to get it back
  // was to notice and flip again — the field's primary job cannot be a
  // casualty of its secondary one.
  useEffect(() => {
    onSearch?.(value);
  }, [onSearch, value]);

  const setConnectMode = (): void => {
    setMode("connect");
    setOpen(true);
  };
  const setSearchMode = (): void => {
    setMode("search");
    setOpen(true);
  };

  const trimmed = value.trim();
  const target = useMemo(() => compactDeviceNumber(value), [value]);
  const parsed = useMemo(
    () => parseConnectTarget(target, /^[0-9a-fA-F]{64}$/.test(target) ? "boundary" : undefined),
    [target],
  );
  /**
   * The user has overridden the chip for what is currently typed. Cleared on
   * every keystroke, so it applies to one address rather than becoming a
   * sticky mode the user cannot see.
   */
  const [flipped, setFlipped] = useState<ProtocolKind | null>(null);

  /**
   * Go through the saved host when the typed address is one we already know:
   * the alternative is an ad-hoc session that silently drops the password and
   * quality the user configured for exactly this machine.
   */
  const savedMatch = useMemo((): HostProfile | null => {
    if (!parsed.ok) return null;
    const { address, port, explicitPort, protocol } = parsed.target;
    // A bare hostname means "that machine", not "that machine on 5900", so it
    // should still find a host saved on 5901 rather than sit above it in the
    // list as a near-identical second row.
    //
    // When the input NAMED a protocol, only a host of that protocol matches:
    // typing `rdp://box` must not connect through a VNC profile saved at that
    // address, which would dial the wrong thing at the wrong port.
    return (
      hosts.find(
        (h) =>
          sameAddress(h.address, address) &&
          (!explicitPort || h.port === port) &&
          (protocol === null || hostProtocol(h) === protocol),
      ) ?? null
    );
  }, [parsed, hosts]);

  /**
   * The protocol this connect will use: what the input named, then a saved
   * host's, then the port preset.
   *
   * The hard rule this exists for is that ambiguity never resolves silently
   * to VNC against port 3389. Whatever it resolves to, the chip shows it
   * before Enter and one click flips it.
   */
  const resolved: ProtocolKind = useMemo(() => {
    if (!parsed.ok) return flipped ?? "vnc";
    return (
      flipped ??
      parsed.target.protocol ??
      (savedMatch ? hostProtocol(savedMatch) : presetProtocol(parsed.target))
    );
  }, [parsed, flipped, savedMatch]);

  /**
   * The port this connect will use, read under the protocol that was chosen.
   *
   * The number after the colon is not the same thing for every protocol: the
   * VNC convention reads `box:22` as DISPLAY 22, which is port 5922, while
   * SSH and RDP have no display numbers and read it as the port 22. So a
   * person who typed `box:22` meaning SSH, saw "VNC" and "port 5922", and
   * clicked the chip to fix it, would still have been dialled on 5922.
   *
   * The parser already knows how to read the input under a given protocol
   * (`parseConnectTarget(input, assume)`), so the chip simply re-reads it.
   */
  const resolvedPort: number = useMemo(() => {
    if (!parsed.ok) return DEFAULT_PORT[resolved];
    if (resolved === "vnc") return parsed.target.port;
    const reread = parseConnectTarget(target, resolved);
    return reread.ok ? reread.target.port : parsed.target.port;
  }, [parsed, resolved, target]);

  /**
   * Was the number a DISPLAY number rather than a port?
   *
   * `box:22` is display 22 on port 5922. The chip says so, because the number
   * the person typed and the port that will be dialled are not the same
   * thing, and that is the whole reason a person who meant SSH can end up on
   * the wrong port.
   */
  const displayNumber: boolean = useMemo(
    () => parsed.ok && resolved === "vnc" && isDisplayNumber(target, parsed.target.port),
    [parsed, resolved, target],
  );

  const connectTyped = (): void => {
    if (!parsed.ok) {
      setAttempted(true);
      return;
    }
    const { address, username } = parsed.target;
    const port = resolvedPort;
    if (savedMatch) {
      onConnectHost(savedMatch);
    } else {
      onConnectAddress(resolved, address, port);
      onRemember(formatTarget(resolved, address, port, username));
    }
    setValue("");
    setAttempted(false);
    setFlipped(null);
    setOpen(false);
  };

  const suggestions = useMemo((): Suggestion[] => {
    const out: Suggestion[] = [];

    if (trimmed !== "" && parsed.ok) {
      const { address, username } = parsed.target;
      const port = resolvedPort;
      const typedLabel = formatTarget(resolved, address, port, username);
      out.push(
        savedMatch
          ? {
              key: "typed",
              kind: "host",
              group: "typed",
              label: t("quick.connectTo", { target: savedMatch.friendlyName }),
              sub: t("quick.savedHost"),
              protocol: hostProtocol(savedMatch),
              run: () => {
                onConnectHost(savedMatch);
                setValue("");
                setFlipped(null);
                setOpen(false);
              },
            }
          : {
              key: "typed",
              kind: "address",
              group: "typed",
              label: t("quick.connectTo", { target: typedLabel }),
              // Silent on a protocol's OWN default port (5900 for VNC, 3389
              // for RDP, 22 for SSH); named otherwise, which is the thing
              // worth reading there. `resolved === "rdp" ? "" : port === 5900`
              // used to special-case VNC's default by number, which read an
              // SSH target on its own default port 22 as "an odd port".
              sub: port === DEFAULT_PORT[resolved] ? "" : t("quick.port", { port }),
              protocol: resolved,
              run: () => {
                onConnectAddress(resolved, address, port);
                onRemember(typedLabel);
                setValue("");
                setFlipped(null);
                setOpen(false);
              },
            },
      );
    }

    if (trimmed !== "") {
      const matches = hosts
        .filter((h) => h.id !== savedMatch?.id)
        .map((h) => ({ h, m: fuzzyMatch(trimmed, `${h.friendlyName} ${h.address}`) }))
        .filter((x): x is { h: HostProfile; m: NonNullable<typeof x.m> } => x.m !== null)
        .sort((a, b) => b.m.score - a.m.score)
        .slice(0, MAX_HOST_SUGGESTIONS);
      for (const { h } of matches) {
        out.push({
          key: `host-${h.id}`,
          group: "hosts",
          kind: "host",
          label: h.friendlyName,
          sub: formatTarget(hostProtocol(h), h.address, h.port),
          protocol: hostProtocol(h),
          run: () => {
            onConnectHost(h);
            setValue("");
            setFlipped(null);
            setOpen(false);
          },
        });
      }

      const nearby = discovered
        .filter((d) => !hosts.some((h) => sameAddress(h.address, d.address) && h.port === d.port))
        .filter((d) => fuzzyMatch(trimmed, `${d.name} ${d.address}`) !== null)
        .slice(0, MAX_NEARBY_SUGGESTIONS);
      for (const d of nearby) {
        const kind = d.protocol ?? "vnc";
        const label = formatTarget(kind, d.address, d.port);
        out.push({
          key: `nearby-${d.id}`,
          group: "nearby",
          kind: "nearby",
          label: d.name,
          sub: label,
          protocol: kind,
          run: () => {
            onConnectAddress(kind, d.address, d.port);
            onRemember(label);
            setValue("");
            setFlipped(null);
            setOpen(false);
          },
        });
      }
    }

    // With an empty field the recents ARE the menu; while typing they are just
    // one more source, and the address row above already covers an exact retype.
    const recentPool = recents.filter((r) => r !== trimmed);
    const recentMatches = (
      trimmed === "" ? recentPool : recentPool.filter((r) => fuzzyMatch(trimmed, r) !== null)
    ).slice(0, MAX_RECENT_SUGGESTIONS);
    for (const r of recentMatches) {
      const p = parseConnectTarget(r);
      if (!p.ok) continue;
      // A recent round trips through `formatTarget`, so its own text says
      // which protocol it was. Anything that does not re-parse to itself
      // would connect somewhere the user never went.
      const kind = p.target.protocol ?? presetProtocol(p.target);
      out.push({
        key: `recent-${r}`,
          group: "recent",
        kind: "recent",
        label: r,
        sub: t("quick.recent"),
        protocol: kind,
        run: () => {
          onConnectAddress(kind, p.target.address, p.target.port);
          onRemember(r);
          setValue("");
          setFlipped(null);
          setOpen(false);
        },
      });
    }

    return out;
  }, [trimmed, parsed, resolved, resolvedPort, savedMatch, hosts, discovered, recents, onConnectHost, onConnectAddress, onRemember, t]);

  useEffect(() => {
    setSelected(-1);
    // The override is for one typed address, not a mode.
    setFlipped(null);
  }, [value]);

  // Discovery arriving or a host being saved can shorten the list under a
  // highlight that is already past its new end, which would leave Enter
  // pointing at nothing while a row still looked chosen.
  useEffect(() => {
    setSelected((s) => Math.min(s, suggestions.length - 1));
  }, [suggestions]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const showList = open && suggestions.length > 0;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setSelected((s) => Math.min(suggestions.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const entry = showList && selected >= 0 ? suggestions[selected] : undefined;
      if (entry) entry.run();
      // The mode only ever decides THIS: connect mode dials whatever is
      // typed, search mode dials only a saved host's exact address.
      else if (enterAction(mode, value, savedMatch !== null) === "connect") connectTyped();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // First Escape dismisses the list, a second one abandons the address.
      if (showList) setOpen(false);
      else {
        setValue("");
        setAttempted(false);
        inputRef.current?.blur();
      }
    }
  };

  const invalid = trimmed !== "" && !parsed.ok;

  return (
    <div className={embedded ? "flex min-w-0 flex-1 items-center gap-2" : "flex items-center gap-2 border-b border-subtle bg-surface/40 px-4 py-2"}>
      {showSupport ? <BoundaryConnect /> : null}
      {showSupport ? <GetHelp /> : null}
      <div className="relative min-w-[17rem] flex-1 md:max-w-xl">
        {searchMode ? (
          <IconSearch
            size={15}
            className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-tertiary"
          />
        ) : (
          <IconMonitor
            size={15}
            className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-tertiary"
          />
        )}
        <input
          ref={inputRef}
          className={searchMode ? "field !pe-20 !ps-8" : "field mono !pe-20 !ps-8"}
          placeholder={
            searchMode
              ? t("library.searchPlaceholder", { chord: modKeyLabel })
              : t("quick.placeholder", { key: modKeyLabel })
          }
          aria-label={searchMode ? t("library.searchAria") : t("quick.label")}
          spellCheck={false}
          autoComplete="off"
          // An address is not a sentence, and the layout is right-to-left by
          // default in this app: without this, the bidi algorithm reorders
          // the parts of `192.168.1.20:1` and `rdp://frontdesk`, and the
          // text ends up somewhere other than where it was typed.
          dir={searchMode ? undefined : "ltr"}
          style={searchMode ? undefined : { unicodeBidi: "isolate" }}
          role="combobox"
          aria-expanded={showList}
          aria-controls="quick-connect-list"
          aria-autocomplete="list"
          /*
            The option the arrow keys have reached.
            
            The combobox pattern keeps the DOM focus in the text field and
            points at the active option with `aria-activedescendant`, so a
            screen reader says which row is highlighted. Without it the field
            announced only what was typed, and the person had no idea which
            of the suggestions Enter would take.
          */
          aria-activedescendant={
            showList && selected >= 0 ? `quick-connect-option-${selected}` : undefined
          }
          aria-invalid={!searchMode && invalid}
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            setAttempted(false);
            setOpen(true);
            if (searchMode && looksLikeAddress(next)) setConnectMode();
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {/*
          A two-state toggle named for the thing it toggles: the label is
          always "connect", and aria-pressed says whether connect mode IS on.
          The tooltip names what clicking does. The old version showed the
          mode you would switch TO while aria-pressed described the mode you
          were in, so the name and the state were about two modes at once.
        */}
        <button
          type="button"
          className="absolute end-1 top-1/2 -translate-y-1/2 rounded-sm bg-inset px-1.5 py-1 text-2xs font-medium text-secondary hover:bg-raised hover:text-primary"
          title={t(toggle.hintKey)}
          aria-pressed={toggle.pressed}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (searchMode) setConnectMode();
            else setSearchMode();
            inputRef.current?.focus();
          }}
        >
          {t("quick.modeConnect")}
        </button>
        {showList ? (
          <div
            ref={listRef}
            id="quick-connect-list"
            role="listbox"
            aria-label={t("quick.suggestions")}
            className="fade-in absolute start-0 end-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md border border-subtle bg-raised p-1.5 shadow-(--shadow-pop)"
          >
            {suggestions.map((s, i) => (
              <div key={s.key}>
                {/*
                  A heading per group. The list used to be one flat wall of up
                  to thirteen rows, so a person who typed a single character
                  got a screen of recents with no way to tell them from their
                  own computers.
                */}
                {i === 0 || suggestions[i - 1].group !== s.group ? (
                  <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wide text-tertiary">
                    {t(GROUP_HEADINGS[s.group])}
                  </p>
                ) : null}
                <button
                  data-index={i}
                  id={`quick-connect-option-${i}`}
                  type="button"
                  role="option"
                  aria-selected={i === selected}
                  /*
                    Out of the tab order.
                    
                    The options live inside a listbox, and the combobox
                    pattern says the list is reached with the arrow keys
                    while the focus stays in the field. A focusable option
                    puts every row in the tab order, so a keyboard user
                    tabbed through the whole list instead of through the
                    field, and the highlight the field had nothing to do
                    with.
                  */
                  tabIndex={-1}
                  className={classNames(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-start",
                    i === selected ? "bg-accent text-accent-fg" : "text-primary hover:bg-inset",
                  )}
                  onPointerMove={() => setSelected(i)}
                  // Keeping focus in the field means the blur that closes this
                  // list cannot land before the click that uses it, which would
                  // unmount this button mid-gesture and swallow the click.
                  // Both events are suppressed because WebKit, which is what
                  // this ships on, has not always honoured the pointer one.
                  onPointerDown={(e) => e.preventDefault()}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={s.run}
                >
                  <span className={i === selected ? "opacity-90" : "text-tertiary"}>
                    <SuggestionIcon kind={s.kind} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label}</span>
                  <span
                    className={classNames(
                      "mono shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                      i === selected ? "bg-black/15" : "bg-inset text-tertiary",
                    )}
                  >
                    {protocolLabel(s.protocol)}
                  </span>
                  {s.sub ? (
                    <span
                      className={classNames(
                        "mono truncate text-xs",
                        i === selected ? "opacity-75" : "text-tertiary",
                      )}
                    >
                      {s.sub}
                    </span>
                  ) : null}
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {/*
        The chip is the answer to "which protocol is this about to speak", and
        it is a button because the answer is sometimes a guess. `box:3389` with
        no saved host is the case it exists for: the guess is visible before
        Enter and one click corrects it. With three protocols the button
        cycles rather than flips, and the tooltip names the protocol one more
        click reaches, so "the other protocol" never has to mean one of two
        unnamed alternatives.

        When the number after the colon was read as a DISPLAY number, the chip
        says so. `box:22` is display 22 on port 5922, and the port that will
        be dialled is not the number that was typed, so the chip carries the
        translation rather than leaving the person to work it out.

        A saved host is NOT a dead grey chip: the app has quietly decided to
        use that profile, and a disabled button cannot explain itself, so the
        chip says "saved" and stays readable.
      */}
      {!searchMode ? (
        <>
      {trimmed !== "" && parsed.ok ? (
        <button
          type="button"
          className={classNames(
            "mono shrink-0 rounded-md border px-2 py-1 text-xs font-semibold",
            savedMatch !== null
              ? "border-subtle text-tertiary"
              : "border-subtle text-secondary hover:text-primary",
          )}
          title={
            savedMatch
              ? t("quick.chipSavedTitle", {
                  name: savedMatch.friendlyName,
                  protocol: protocolName(hostProtocol(savedMatch)),
                })
              : t("quick.chipTitle", {
                  protocol: protocolName(resolved),
                  next: protocolName(nextProtocol(resolved)),
                })
          }
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => {
            // A saved profile decides the protocol on its own, so there is
            // nothing to flip: the click says so rather than doing nothing.
            if (savedMatch !== null) {
              onConnectHost(savedMatch);
              return;
            }
            setFlipped(nextProtocol(resolved));
          }}
        >
          {savedMatch !== null
            ? t("quick.chipSaved")
            : displayNumber
              ? t("quick.chipDisplay", {
                  protocol: protocolLabel(resolved),
                  display: (resolvedPort - DEFAULT_PORT.vnc).toString().padStart(2, "0"),
                })
              : protocolLabel(resolved)}
        </button>
      ) : null}
      <button
        type="button"
        className="btn-secondary shrink-0"
        disabled={trimmed === ""}
        onClick={connectTyped}
      >{t("quick.connect")}</button>
      {invalid ? (
        <span
          className={classNames("truncate text-xs", attempted ? "text-danger" : "text-tertiary")}
          role={attempted ? "alert" : undefined}
        >
          {parsed.ok ? null : addressErrorText(parsed, t)}
        </span>
      ) : (
        <span className="truncate text-xs text-tertiary">
          {savedMatch
            ? t("quick.viaSaved", { name: savedMatch.friendlyName })
            : t("quick.remembered")}
        </span>
      )}
        </>
      ) : null}
    </div>
  );
}

function SuggestionIcon({ kind }: { kind: Suggestion["kind"] }): ReactNode {
  switch (kind) {
    case "address":
      return <IconArrowRight size={16} />;
    case "nearby":
      return <IconZap size={16} />;
    case "recent":
      return <IconClock size={16} />;
    default:
      return <IconMonitor size={16} />;
  }
}
