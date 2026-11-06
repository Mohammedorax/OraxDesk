/** Add/Edit host dialog with progressive disclosure (PRD/11 §3.3). */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type {
  HostGroup,
  HostProfile,
  HostTag,
  OsHint,
  ProtocolKind,
  QualityPreset,
  ScalingMode,
  SshTunnelSettings,
} from "../lib/types";
import {
  DEFAULT_PORT,
  HOST_PROTOCOLS,
  blankSshTunnel,
  hostProtocol,
  parseSshTunnel,
} from "../lib/types";
import type { RdpResolution, RdpSettings } from "../lib/rdp";
import { rdpDefaults } from "../lib/rdpDefaults";
import {
  blankRdpSettings,
  parseRdpSettings,
  RDP_FIXED_SIZES,
  RDP_MAX_DIM,
  RDP_MIN_DIM,
} from "../lib/rdp";
import type { MultiplexerKind, SshAuthKind, SshSettings } from "../lib/ssh";
import { blankSshSettings, parseSshSettings } from "../lib/ssh";
import { sshDefaults } from "../lib/sshDefaults";
import type { LocalKeys } from "../lib/tauri";
import {
  hasSavedPassword,
  pickPrivateKeyFile,
  savedUserNames,
  sshListLocalKeys,
  sshListWslDistros,
} from "../lib/tauri";
import { MOCK_LOCAL_KEYS, useMockData } from "../lib/mock";
import {
  cleanDisplayName,
  portOnProtocolChange,
  portWasTouched,
  vncTakesUsername,
} from "../lib/hostDraft";
import { addressErrorText, parseConnectTarget } from "../lib/address";
import { Dialog, Select } from "./primitives";
import { IconChevronDown, IconChevronRight } from "./icons";
import { classNames } from "../lib/util";
import { radioMove } from "../lib/radioGroup";
import { useLang, useT, type MessageKey, type Translate } from "../lib/i18n";

export interface HostDraft {
  id?: string;
  /**
   * Whether this host does not exist yet.
   *
   * The id alone cannot say that any more: a new host is given its id when
   * the draft is made, so that two saves of the same draft write the same row
   * instead of two rows. This flag is what says "new" now.
   */
  isNew?: boolean;
  friendlyName: string;
  protocol: ProtocolKind;
  address: string;
  port: number;
  groupId: string | null;
  tagIds: string[];
  osHint: OsHint;
  password: string;
  hasPassword: boolean;
  securityPref: string | null;
  qualityPref: QualityPreset;
  scalingMode: ScalingMode;
  keyboardMode: string;
  passthrough: boolean;
  /** Parsed `sshTunnel` blob; `null` when the host has never configured one. */
  sshTunnel: SshTunnelSettings | null;
  /**
   * SSH passphrase (or key passphrase) to save. Like `password`, write-only:
   * empty means "leave whatever is in the keychain alone", and nothing stored
   * is ever read back into the dialog.
   */
  sshPassphrase: string;
  wolMac: string | null;
  /**
   * UI-only: this MAC came from discovery, not from the stored profile. Drives
   * the "we filled this in for you" hint and opens the Advanced section, so an
   * auto-filled value is never applied out of sight. Never persisted.
   */
  macFromDiscovery?: boolean;

  /** Parsed `rdpSettings` blob; `null` for a VNC host. */
  rdp: RdpSettings | null;
  /**
   * RDP account name, written on save alongside the password.
   *
   * Seeded blank, then filled in for a saved host from `saved_user_names`
   * once the dialog opens. A blank box still means "keep what is stored",
   * the same as the password box, which is never filled in.
   */
  rdpUser: string;
  /** Logon domain, part of the stored credential rather than the profile
   *  blob's `domain`. Blank means "leave what is stored alone". */
  rdpDomain: string;
  /** Parsed `sshSettings` blob; `null` for a non-SSH host. */
  ssh: SshSettings | null;
  /**
   * SSH account name, written on save alongside the password as
   * `StoredCredentials.sshUser`.
   *
   * Seeded BLANK even for a saved host, for the same reason `rdpUser` is:
   * there is no `get_password`, so blank carries the "leave what is stored
   * alone" affordance rather than "connect as nobody". An empty value here
   * is also a legitimate END state, not just a placeholder: the Rust side
   * reads a blank `sshUser` as "the same account as this computer", so a
   * host that never sets this field is not missing anything.
   */
  sshUser: string;
  /**
   * VNC account name, for the security types that sign in with one (see
   * `vncTakesUsername`), written on save as `StoredCredentials.vencryptUser`.
   *
   * Seeded BLANK even for a saved host, for the same reason `rdpUser` is.
   * Blank is also a legitimate end state: the connect path then asks for the
   * name at the prompt, as it always has.
   */
  vncUser: string;
  /**
   * UI-only: the user has deliberately set the port, so switching protocol
   * must not move it. Never persisted.
   */
  portTouched?: boolean;
}

export function draftFromHost(h: HostProfile | null, prefill?: Partial<HostDraft>): HostDraft {
  const protocol: ProtocolKind = h ? hostProtocol(h) : (prefill?.protocol ?? "vnc");
  return {
    // A new host is given its id HERE, when the draft is made, rather than
    // when it is saved. The id doubles as the keyring account key on the
    // Rust side, and a second save of the same draft (a double click on Save)
    // used to mint a second id, which is a second identical row in the
    // library rather than an update of the first.
    id: h?.id ?? prefill?.id ?? crypto.randomUUID(),
    isNew: h === null && prefill?.id === undefined,
    friendlyName: h?.friendlyName ?? prefill?.friendlyName ?? "",
    protocol,
    address: h?.address ?? prefill?.address ?? "",
    port: h?.port ?? prefill?.port ?? DEFAULT_PORT[protocol],
    groupId: h?.groupId ?? null,
    tagIds: h?.tags ?? [],
    osHint: h?.osHint ?? prefill?.osHint ?? "unknown",
    password: "",
    hasPassword: h?.hasPassword ?? false,
    securityPref: h?.securityPref ?? null,
    qualityPref: h?.qualityPref ?? "auto",
    scalingMode: h?.scalingMode ?? "aspect-fit",
    keyboardMode: h?.keyboardMode ?? "auto",
    passthrough: h?.passthrough ?? false,
    sshTunnel: parseSshTunnel(h?.sshTunnel),
    sshPassphrase: "",
    // Falls through to the prefill so a MAC learned by discovery survives into
    // the draft, both for a brand-new host and for a saved one that has none.
    wolMac: h?.wolMac ?? prefill?.wolMac ?? null,
    macFromDiscovery: !h?.wolMac && Boolean(prefill?.wolMac),
    // A new host starts from the Preferences defaults; a saved one is read
    // back verbatim, because its own settings are the answer.
    rdp: protocol === "rdp" ? (parseRdpSettings(h?.rdpSettings) ?? newRdpSettings()) : null,
    rdpUser: "",
    rdpDomain: "",
    ssh: protocol === "ssh" ? (parseSshSettings(h?.sshSettings) ?? newSshSettings()) : null,
    sshUser: "",
    vncUser: "",
    portTouched: portWasTouched(h),
  };
}

/** A blank set of RDP settings with the Preferences defaults applied. */
function newRdpSettings(): RdpSettings {
  return { ...blankRdpSettings(), ...rdpDefaults() };
}

/** A blank set of SSH settings with the Preferences defaults applied. */
function newSshSettings(): SshSettings {
  return { ...blankSshSettings(), ...sshDefaults() };
}

/** Either of the Security disclosure's switches is already on. */
function securityIsOn(d: HostDraft): boolean {
  return d.protocol === "rdp" && (d.rdp?.nla === "allow-fallback" || d.rdp?.legacyTls === true);
}

/**
 * What a protocol offers, so a field can ask "does this protocol have
 * this?" instead of "is this RDP?".
 *
 * A gate built around one protocol reads correctly for two: `!isRdp` meant
 * "the VNC-only field" back when RDP was the only other option. It reads
 * wrong for three, because SSH is not RDP either, and `!isRdp` would let a
 * VNC-only control reappear for it. Keying the lookup on every member of
 * `ProtocolKind` means TypeScript checks it against the type, so a fourth
 * protocol added without a row here is a compile error rather than a field
 * that silently reappears for it.
 */
interface ProtocolCaps {
  /**
   * Has a remote desktop picture. Quality, scaling, keyboard mode, the RFB
   * security type, the "capture system shortcuts" default, and (through
   * `RdpOptionsSection`) the display and resolution settings all describe
   * how a picture is drawn or controlled. None of it means anything to a
   * terminal, which has neither a picture nor a cursor.
   */
  graphical: boolean;
  /** RFB security type negotiation, VNC's own. RDP negotiates its own
   *  security below (see `SecuritySection`), and SSH's transport security
   *  is not a setting this app exposes a knob for. */
  rfbSecurity: boolean;
  /** A logon account name field, always. VNC has one only for some security
   *  types, which `vncTakesUsername` decides from the draft. */
  username: boolean;
  /** A separate logon domain field, alongside username. */
  domain: boolean;
}

const PROTOCOL_CAPS: Record<ProtocolKind, ProtocolCaps> = {
  boundary: { graphical: true, rfbSecurity: false, username: false, domain: false },
  vnc: { graphical: true, rfbSecurity: true, username: false, domain: false },
  rdp: { graphical: true, rfbSecurity: false, username: true, domain: true },
  ssh: { graphical: false, rfbSecurity: false, username: true, domain: false },
};

/**
 * The three ways to sign in to an SSH host, in the order people actually
 * reach for them. Password and key file come first because they are the two
 * everybody knows; the agent is last because it is the one that needs
 * nothing typed and nothing chosen, so it is the one nobody goes looking for.
 *
 * The choices are catalogue keys rather than words: the label on the button
 * and the hint under it are both said in the language the app is in.
 */
const SSH_AUTH_CHOICES: ReadonlyArray<readonly [SshAuthKind, MessageKey]> = [
  ["password", "host.sshAuthPassword"],
  ["key-file", "host.sshAuthKeyFile"],
  ["agent", "host.sshAuthAgent"],
];

const SSH_AUTH_HINT: Record<SshAuthKind, MessageKey> = {
  password: "host.sshAuthPasswordHint",
  "key-file": "host.sshAuthKeyFileHint",
  agent: "host.sshAuthAgentHint",
};

/**
 * The protocol names, in the language the app is in.
 *
 * The names come from `lib/types.ts`, which has no translator of its own, so
 * the dialog asks the catalogue for them instead. The long name goes in the
 * tooltip and the short one on the button, and both are said.
 */
const PROTOCOL_NAME_KEYS: Record<ProtocolKind, MessageKey> = {
  boundary: "host.protocolNameBoundary",
  rdp: "host.protocolNameRdp",
  ssh: "host.protocolNameSsh",
  vnc: "host.protocolNameVnc",
};

const PROTOCOL_SHORT_NAME_KEYS: Record<ProtocolKind, MessageKey> = {
  boundary: "host.protocolBoundary",
  rdp: "host.protocolRdp",
  ssh: "host.protocolSsh",
  vnc: "host.protocolVnc",
};

export function HostDialog({
  draft: initial,
  groups,
  tags,
  onSave,
  onClose,
}: {
  draft: HostDraft;
  groups: HostGroup[];
  tags: HostTag[];
  onSave: (draft: HostDraft) => void | Promise<void>;
  onClose: () => void;
}): ReactNode {
  const t = useT();
  const lang = useLang();
  const [d, setD] = useState<HostDraft>(initial);
  /**
   * A save is in flight.
   *
   * The button used to stay live while the write was running, so a second
   * click sent a second `save_host`. For a new host that was two different
   * ids, and therefore two identical rows in the library.
   */
  const [saving, setSaving] = useState(false);
  // Open Advanced when the dialog arrives with a MAC the user never typed, // discovery filled it in, and a value silently folded away is one the user
  // can neither check nor correct. An enabled SSH tunnel opens it too: it
  // changes how every connection is made and should not be editable only for
  // those who remember it exists.
  const [advanced, setAdvanced] = useState(
    () =>
      Boolean(initial.macFromDiscovery) ||
      Boolean(initial.sshTunnel?.enabled) ||
      securityIsOn(initial),
  );
  // The Security disclosure opens by itself when either of its switches is
  // already on, for the same reason Advanced does: a setting that changes how
  // the connection is made must never be editable only by people who
  // remember it exists.
  const [security, setSecurity] = useState(() => securityIsOn(initial));
  const [touched, setTouched] = useState(false);

  const set = (patch: Partial<HostDraft>): void => setD((prev) => ({ ...prev, ...patch }));

  /**
   * Move through a radio group with the arrow keys.
   *
   * `role="radiogroup"` alone told a screen reader this was one group and
   * nothing else: the arrows did nothing, and every option sat in the tab
   * order. Selection and focus move together, only the chosen option is
   * tabbable, and Left/Right follow `dir` so the arrows point the way the
   * options are laid out on screen.
   */
  const onRadioKey = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    count: number,
    select: (index: number) => void,
    refs: React.RefObject<Array<HTMLButtonElement | null>>,
  ): void => {
    const next = radioMove(e.key, index, count, lang === "ar" ? "rtl" : "ltr");
    if (next === null) return;
    e.preventDefault();
    select(next);
    refs.current?.[next]?.focus();
  };
  const protocolRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sshAuthRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // A saved host shows the account names it signs in with. They start blank
  // in the draft and arrive a moment later from the keychain; a box the user
  // has already typed in is left alone. Whether a password is saved is asked
  // of the keychain too: the library's flag was not set by an editor save
  // before 0.29.1, so it can say "none" for a password that is there.
  useEffect(() => {
    if (!initial.id) return;
    let live = true;
    if (initial.protocol !== "boundary") {
      void hasSavedPassword(initial.id, initial.protocol).then((saved) => {
        if (live && saved) setD((prev) => ({ ...prev, hasPassword: true }));
      });
    }
    void savedUserNames(initial.id).then((names) => {
      if (!live || !names) return;
      setD((prev) => ({
        ...prev,
        vncUser: prev.vncUser || names.vncUser || "",
        rdpUser: prev.rdpUser || names.rdpUser || "",
        rdpDomain: prev.rdpDomain || names.rdpDomain || "",
        sshUser: prev.sshUser || names.sshUser || "",
      }));
    });
    return () => {
      live = false;
    };
  }, [initial.id, initial.protocol]);

  // `isRdp` still names one protocol on purpose: it only selects between the
  // two GRAPHICAL protocols' own quirks (RdpOptionsSection, SecuritySection,
  // the wording of a shared hint), inside sections already gated on
  // `caps.graphical` so SSH never reaches them. Anything that decides
  // whether a field exists AT ALL for a protocol goes through `caps` instead.
  const isRdp = d.protocol === "rdp";
  const isSsh = d.protocol === "ssh";
  const isBoundary = d.protocol === "boundary";
  const caps = PROTOCOL_CAPS[d.protocol];
  // Keyed on `rfbSecurity` rather than on the protocol's name: the security
  // type is what decides whether an RFB logon has an account in it.
  const showVncUser = caps.rfbSecurity && vncTakesUsername(d.securityPref, d.osHint);
  const rdp = d.rdp ?? blankRdpSettings();
  const setRdp = (patch: Partial<RdpSettings>): void => set({ rdp: { ...rdp, ...patch } });
  const ssh = d.ssh ?? blankSshSettings();
  const setSsh = (patch: Partial<SshSettings>): void => set({ ssh: { ...ssh, ...patch } });

  /**
   * Switching protocol reorganises the form, so it also has to move the port,
   * but only when the port is still the outgoing protocol's default and the
   * user has not deliberately set it. The rule itself is a pure function in
   * `lib/hostDraft.ts` so it can be tested without rendering.
   */
  const changeProtocol = (to: ProtocolKind): void => {
    if (to === d.protocol) return;
    set({
      protocol: to,
      port: portOnProtocolChange(d.protocol, to, d.port, d.portTouched === true),
      rdp: to === "rdp" ? (d.rdp ?? newRdpSettings()) : d.rdp,
      ssh: to === "ssh" ? (d.ssh ?? newSshSettings()) : d.ssh,
      // Prefilled, not forced: xrdp on Linux exists, and so does a Mac with
      // an RDP server on it.
      osHint: to === "rdp" && d.osHint === "unknown" ? "windows" : d.osHint,
    });
  };

  // The same parser the connection itself uses, so the dialog refuses exactly
  // what would fail to connect, and says why instead of just "invalid". It is
  // told which protocol to parse as, so `box:1` in an RDP host's address field
  // reads as port 1 rather than as display 1.
  const parsed = useMemo(
    () => parseConnectTarget(d.address, d.protocol),
    [d.address, d.protocol],
  );

  // The parser answers with a catalogue key, so it is translated here: the
  // sentence the person reads is the one in THEIR language.
  const addressError = touched && !parsed.ok ? addressErrorText(parsed, t) : null;

  /**
   * The port has to be a number the backend can hold. It is a `u16` there,
   * so a value outside 1..65535 is refused at the boundary and the whole
   * save fails with a message that says nothing about the port.
   */
  const portError =
    !isBoundary && (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535)
      ? t("host.portRange")
      : null;

  /**
   * The SSH session name and the WSL distribution name are refused by the
   * Rust side, which is what `sessionNameError` and `distroNameError` mirror.
   *
   * The error used to be a hint under the field and nothing more: the host
   * was saved with a name the backend refuses, and every SSH connection to
   * that profile then failed at connect time with a message about the
   * session rather than about the field the person had typed it in.
   *
   * Only a value the person CHANGED is refused. A profile stored with a name
   * this build no longer accepts can still be edited in every other way.
   */
  const sshNameChanged = isSsh && ssh.sessionName !== (initial.ssh?.sessionName ?? "");
  const sshDistroChanged =
    isSsh && (ssh.wslDistro ?? "") !== (initial.ssh?.wslDistro ?? "");
  const sshError = !isSsh
    ? null
    : sshNameChanged
      ? sessionNameError(ssh.sessionName, t)
      : sshDistroChanged
        ? distroNameError(ssh.wslDistro ?? "", t)
        : null;

  /**
   * The MAC address, checked where it is typed rather than when the person
   * finally presses "Wake" on an evening they needed the machine awake.
   */
  const macError = macAddressError(d.wolMac, t);

  /**
   * Everything that would refuse the save, in one place.
   *
   * The Save button used to be disabled for all of these at once, which meant
   * a grey button and no reason: the address error only appeared after the
   * field lost focus, and the SSH errors live inside a disclosure that is
   * closed by default. The button is now only disabled while a save is
   * running, and pressing it says what is wrong.
   */
  const blockers: string[] = [];
  // The address error is already under the address field, so it is only
  // repeated in the summary once that field has been left or the save has
  // been attempted. Before that, an empty address is not a mistake, it is
  // just an empty form.
  if (touched && !parsed.ok) blockers.push(addressErrorText(parsed, t));
  if (portError) blockers.push(portError);
  if (sshError) blockers.push(sshError);
  if (macError) blockers.push(macError);

  const submit = (): void => {
    if (saving) return;
    setTouched(true);
    if (!parsed.ok) return;
    // The other checks too, not only the address. The button is no longer
    // disabled for them (that is what made the reason invisible), so this is
    // the one place that refuses the save.
    if (portError || sshError || macError) return;
    // Saving straight from the keyboard skips the blur that normalizes the
    // address, so it is normalized here too rather than only on the way out
    // of the field.
    const address = parsed.target.address;
    // Same reason as the address: the name reaches a native window title and
    // a menu row, so a control character in it is cleaned here rather than
    // refused by the store after the whole form has been filled in.
    const name = cleanDisplayName(d.friendlyName, address);
    const result = onSave({ ...d, address, friendlyName: name });
    if (result instanceof Promise) {
      setSaving(true);
      void result.finally(() => setSaving(false));
    }
  };

  return (
    <Dialog title={d.isNew ? t("host.new") : t("host.edit")} onClose={onClose} width={540}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label={t("host.name")}
          optional
          hint={t("host.nameHint")}
        >
          <input
            className="field"
            value={d.friendlyName}
            placeholder={t("host.namePlaceholder")}
            onChange={(e) => set({ friendlyName: e.target.value })}
          />
        </Field>

        {/*
          Above the address row, because it changes what the rest of the form
          means and a control that reorganises a form comes before the form.
        */}
        <Field label={t("host.connectUsing")}>
          <div
            className="flex gap-1 rounded-md border border-subtle p-0.5"
            role="radiogroup"
            aria-label={t("host.protocolAria")}
          >
            {HOST_PROTOCOLS.map((p, i) => (
              <button
                key={p}
                ref={(el) => {
                  protocolRefs.current[i] = el;
                }}
                type="button"
                role="radio"
                aria-checked={d.protocol === p}
                tabIndex={d.protocol === p ? 0 : -1}
                title={t(PROTOCOL_NAME_KEYS[p])}
                className={classNames(
                  "flex-1 rounded-sm px-3 py-1.5 text-sm",
                  d.protocol === p
                    ? "bg-accent/12 font-medium text-accent"
                    : "text-secondary hover:text-primary",
                )}
                onClick={() => changeProtocol(p)}
                onKeyDown={(e) =>
                  onRadioKey(
                    e,
                    i,
                    HOST_PROTOCOLS.length,
                    (next) => changeProtocol(HOST_PROTOCOLS[next]),
                    protocolRefs,
                  )
                }
              >
                {t(PROTOCOL_SHORT_NAME_KEYS[p])}
              </button>
            ))}
          </div>
        </Field>

        <div className={isBoundary ? "grid grid-cols-1 gap-3" : "grid grid-cols-[1fr_120px] gap-3"}>
          <Field
            label={isBoundary ? t("host.computerId") : t("host.address")}
            required
            error={addressError}
            hint={isBoundary ? t("host.computerIdHint") : t("host.addressHint")}
          >
            <input
              className="field mono"
              value={d.address}
              placeholder={isBoundary ? t("host.computerIdPlaceholder") : t("host.addressPlaceholder")}
              spellCheck={false}
              dir="ltr"
              aria-invalid={addressError !== null}
              onBlur={() => {
                setTouched(true);
                // Store what would actually be dialled, not what was typed:
                // `  office  ` and `[::1]` are accepted above but would be
                // saved verbatim and then never resolve, and an address that
                // does not match the canonical form cannot be recognised as
                // a saved host when it is typed into QuickConnect later.
                if (parsed.ok) set({ address: parsed.target.address });
              }}
              onChange={(e) => {
                const typed = parseConnectTarget(e.target.value, d.protocol);
                // Only a port the user actually typed moves into the Port
                // field; a bare hostname leaves this profile's saved port
                // alone. Anything else stays as typed so the field stays
                // editable while it is still half-written.
                //
                // A port that arrived this way counts as deliberately set,
                // so a later protocol switch leaves it where it is.
                set(
                  typed.ok && typed.target.explicitPort
                    ? {
                        address: typed.target.address,
                        port: typed.target.port,
                        portTouched: true,
                      }
                    : { address: e.target.value },
                );
              }}
            />
          </Field>
          {isBoundary ? null : (
            <Field label={t("host.port")} error={portError}>
              <input
                className="field mono"
                type="number"
                min={1}
                max={65535}
                value={d.port}
                onChange={(e) => {
                  // The port is a `u16` on the Rust side, so anything outside
                  // 1..65535 is refused by the deserializer and the save
                  // fails with "invalid args". The `min` and `max` attributes
                  // only produce a browser bubble on submit, so the value is
                  // clamped here and the problem is said out loud.
                  const typed = Number.parseInt(e.target.value, 10);
                  if (Number.isNaN(typed)) {
                    set({ port: DEFAULT_PORT[d.protocol], portTouched: true });
                    return;
                  }
                  set({
                    port: Math.min(65535, Math.max(1, typed)),
                    portTouched: true,
                  });
                }}
              />
            </Field>
          )}
        </div>

        {/*
          The logon fields are driven by capability, not by protocol name:
          RDP needs a user name and, for a directory account, a domain; SSH
          needs only a user name, and treats a blank one as "the same account
          as this computer" rather than as something it has to guess. VNC
          only has an account when its security type signs in with one, Apple
          Screen Sharing above all, so its field comes and goes with that
          choice. A logon is user first, so the name field sits above the
          password rather than beside the security type.
        */}
        {showVncUser ? (
          <Field
            label={t("host.userName")}
            hint={
              d.hasPassword && !d.vncUser
                ? t("host.keepSaved")
                : t("host.askedAtConnect")
            }
          >
            <input
              className="field"
              value={d.vncUser}
              placeholder={
                d.hasPassword
                  ? t("host.unchanged")
                  : d.osHint === "macos"
                    ? t("host.macAccount")
                    : t("host.optional")
              }
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => set({ vncUser: e.target.value })}
            />
          </Field>
        ) : null}
        {caps.username ? (
          caps.domain ? (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t("host.userName")}
                hint={
                  d.hasPassword && !d.rdpUser
                    ? t("host.keepSaved")
                    : t("host.accountToSignIn")
                }
              >
                <input
                  className="field"
                  value={d.rdpUser}
                  placeholder={d.hasPassword ? t("host.unchanged") : t("host.administrator")}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => set({ rdpUser: e.target.value })}
                />
              </Field>
              {/*
                The hint is doing real work. Splitting a UPN into a domain is
                the classic way to break an Entra ID sign-in, and nothing in
                this app will do it for the user, so the field has to say when
                to leave itself empty.
              */}
              <Field label={t("host.domain")} hint={t("host.domainHint")}>
                <input
                  className="field"
                  value={d.rdpDomain}
                  placeholder={t("host.optional")}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => set({ rdpDomain: e.target.value })}
                />
              </Field>
            </div>
          ) : (
            <Field
              label={t("host.userName")}
              hint={
                d.hasPassword && !d.sshUser
                  ? t("host.keepSaved")
                  : t("host.sameUserAsComputer")
              }
            >
              <input
                className="field"
                value={d.sshUser}
                placeholder={d.hasPassword ? t("host.unchanged") : t("host.sameAsThisComputer")}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => set({ sshUser: e.target.value })}
              />
            </Field>
          )
        ) : null}

        {/*
          A password or a key: that is the whole question, and for an SSH host
          it is the second thing anybody decides after the address. It used to
          live inside Advanced, under a heading about agents, which meant the
          ordinary "I use a key for this box" case was three clicks and a
          typed path away and looked like an expert setting. It sits in the
          main form now, directly above the secret it decides the meaning of.
        */}
        {isSsh ? (
          <Field label={t("host.signInWith")} hint={t(SSH_AUTH_HINT[ssh.auth])}>
            <div
              className="flex gap-1 rounded-md border border-subtle p-0.5"
              role="radiogroup"
              aria-label={t("host.sshAuthAria")}
            >
              {SSH_AUTH_CHOICES.map(([kind, label], i) => (
                <button
                  key={kind}
                  ref={(el) => {
                    sshAuthRefs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={ssh.auth === kind}
                  tabIndex={ssh.auth === kind ? 0 : -1}
                  className={classNames(
                    "flex-1 rounded-sm px-3 py-1.5 text-sm",
                    ssh.auth === kind
                      ? "bg-accent/12 font-medium text-accent"
                      : "text-secondary hover:text-primary",
                  )}
                  onClick={() => setSsh({ auth: kind })}
                  onKeyDown={(e) =>
                    onRadioKey(
                      e,
                      i,
                      SSH_AUTH_CHOICES.length,
                      (next) => setSsh({ auth: SSH_AUTH_CHOICES[next][0] }),
                      sshAuthRefs,
                    )
                  }
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </Field>
        ) : null}

        {isSsh && ssh.auth === "key-file" ? (
          <KeyFileField value={ssh.keyPath} onChange={(keyPath) => setSsh({ keyPath })} />
        ) : null}

        {/*
          An agent holds the secret itself, so there is nothing to type here
          and an empty box would only invite somebody to put their login
          password in it. Every other choice needs one secret, and it is the
          same keychain slot either way: an account password for password
          auth, the key's passphrase for a key file. The Rust side reads that
          one slot as whichever the auth kind says it is, so the label is what
          has to change, not the storage.
        */}
        {isSsh && ssh.auth === "agent" ? null : (
          <Field
            label={
              isSsh && ssh.auth === "key-file"
                ? t("host.keyPassphrase")
                : t("host.password")
            }
            hint={
              d.hasPassword && !d.password
                ? t("host.secretSavedHint")
                : isSsh && ssh.auth === "key-file"
                  ? t("host.keyPassphraseHint")
                  : isBoundary
                    ? t("host.boundaryPasswordHint")
                    : t("host.storedInKeychain")
            }
          >
            <input
              className="field"
              type="password"
              value={d.password}
              placeholder={d.hasPassword ? t("host.passwordUnchanged") : t("host.optional")}
              autoComplete="off"
              onChange={(e) => set({ password: e.target.value })}
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("host.group")}>
            <Select
              value={d.groupId ?? ""}
              onChange={(e) => set({ groupId: e.target.value || null })}
            >
              <option value="">{t("host.noGroup")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("host.os")}>
            <Select
              value={d.osHint}
              onChange={(e) => set({ osHint: e.target.value as OsHint })}
            >
              <option value="unknown">{t("host.osUnknown")}</option>
              <option value="macos">macOS</option>
              <option value="windows">Windows</option>
              <option value="linux">Linux</option>
              <option value="qemu">{t("host.osQemu")}</option>
            </Select>
          </Field>
        </div>

        {tags.length > 0 ? (
          <Field label={t("host.tags")}>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => {
                const on = d.tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    className={classNames(
                      "rounded-pill border px-2.5 py-1 text-xs",
                      on ? "border-transparent font-medium text-white" : "border-subtle text-secondary",
                    )}
                    style={on ? { background: t.color } : undefined}
                    onClick={() =>
                      set({
                        tagIds: on ? d.tagIds.filter((x) => x !== t.id) : [...d.tagIds, t.id],
                      })
                    }
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </Field>
        ) : null}

        {/* Advanced accordion */}
        <div className="rounded-md border border-subtle">
          <button
            type="button"
            aria-expanded={advanced}
            className="flex w-full items-center gap-1.5 px-3 py-2.5 text-sm font-medium text-secondary hover:text-primary"
            onClick={() => setAdvanced((a) => !a)}
          >
            {advanced ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            {t("host.advanced")}
          </button>
          {advanced ? (
            <div className="space-y-4 border-t border-subtle p-3">
              {/*
                Security type, Quality, Scaling and Keyboard mode all describe
                a remote PICTURE: how it is negotiated, compressed, fitted to
                the window, and typed into. None of that exists for a
                terminal, so the whole block is gated on `caps.graphical`
                rather than repeating that gate on every field inside it.
              */}
              {caps.graphical ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {/* RFB security types are VNC's own negotiation; RDP's
                        equivalent is the Security disclosure below. */}
                    {caps.rfbSecurity ? (
                      <Field label={t("host.securityType")} hint={t("host.securityTypeHint")}>
                        <Select
                          value={d.securityPref ?? "auto"}
                          onChange={(e) =>
                            set({ securityPref: e.target.value === "auto" ? null : e.target.value })
                          }
                        >
                          <option value="auto">{t("host.auto")}</option>
                          <option value="vencrypt-x509">VeNCrypt (TLS + X.509)</option>
                          <option value="ra2">RSA-AES (RA2)</option>
                          <option value="apple-dh">{t("host.securityAppleDh")}</option>
                          <option value="vncauth">{t("host.securityVncPassword")}</option>
                          <option value="none">{t("host.none")}</option>
                        </Select>
                      </Field>
                    ) : null}
                    <Field
                      label={t("host.quality")}
                      hint={isRdp ? t("host.qualityRdpHint") : t("host.qualityHint")}
                    >
                      <Select
                        value={d.qualityPref}
                        onChange={(e) => set({ qualityPref: e.target.value as QualityPreset })}
                      >
                        {/*
                          The same words the toolbar uses for the same
                          setting. They used to be "High / Medium / Low" here
                          and "Sharp / Balanced / Responsive" there, so a
                          person who set one and later opened the other could
                          not tell it was the same choice.
                        */}
                        <option value="auto">{t("host.auto")}</option>
                        <option value="high">{t("host.qualitySharp")}</option>
                        <option value="medium">{t("host.qualityBalanced")}</option>
                        <option value="low">{t("host.qualityResponsive")}</option>
                        {/*
                          Black and White is a shader in this app, not a wire
                          setting, so the toolbar keeps offering it live for
                          both graphical protocols. As a STORED default for an
                          RDP host it would quietly mean "low quality, plus a
                          grey screen on every connect", which is not what
                          choosing a saved default is for.
                        */}
                        {isRdp ? null : <option value="bw">{t("host.qualityBw")}</option>}
                      </Select>
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("host.scaling")} hint={t("host.scalingHint")}>
                      <Select
                        value={d.scalingMode}
                        onChange={(e) => set({ scalingMode: e.target.value as ScalingMode })}
                      >
                        <option value="aspect-fit">{t("host.scalingAspectFit")}</option>
                        <option value="fit">{t("host.scalingFit")}</option>
                        <option value="actual">{t("host.scalingActual")}</option>
                        <option value="remote-resize">{t("host.scalingRemoteResize")}</option>
                      </Select>
                    </Field>
                    {/*
                      "Keyboard mode" used to be here, offering Keysym,
                      Unicode and Scancode. Nothing ever read it: the profile's
                      `keyboard_mode` column is not read by the backend, and
                      the session always sends keysyms. A control that looks
                      like a setting and changes nothing is worse than no
                      control, so it is gone until there is something behind
                      it. The column stays in the store, untouched, so a
                      profile written by a newer build is not damaged.
                    */}
                  </div>
                </>
              ) : null}
              <Field
                label={t("host.macLabel")}
                error={macError}
                hint={
                  macError
                    ? undefined
                    : d.macFromDiscovery
                      ? t("host.macFoundHint")
                      : t("host.macAutoHint")
                }
              >
                <input
                  className="field mono"
                  value={d.wolMac ?? ""}
                  placeholder="aa:bb:cc:dd:ee:ff"
                  spellCheck={false}
                  dir="ltr"
                  aria-label={t("host.macAria")}
                  aria-invalid={macError !== null}
                  onChange={(e) => set({ wolMac: e.target.value || null, macFromDiscovery: false })}
                />
              </Field>
              {/* Waking a sleeping machine is orthogonal to how you talk to it
                  once it is up, so this stays available for every protocol;
                  "capture system shortcuts" is not, since a terminal has no
                  window to steal a shortcut away from. */}
              {caps.graphical ? (
                <label className="flex items-start gap-2.5 text-sm text-primary">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-(--accent)"
                    checked={d.passthrough}
                    onChange={(e) => set({ passthrough: e.target.checked })}
                  />
                  <span>
                    {t("host.captureShortcuts")}
                    <span className="block text-xs text-tertiary">
                      {isRdp ? t("host.captureShortcutsRdp") : t("host.captureShortcutsOther")}
                    </span>
                  </span>
                </label>
              ) : null}
              {isRdp ? <RdpOptionsSection rdp={rdp} onChange={setRdp} /> : null}
              {isRdp ? (
                <SecuritySection
                  rdp={rdp}
                  open={security}
                  onToggle={() => setSecurity((v) => !v)}
                  onChange={setRdp}
                />
              ) : null}
              {isSsh ? (
                <SshOptionsSection
                  ssh={ssh}
                  onChange={setSsh}
                  host={d.address}
                  port={d.port}
                  username={d.sshUser}
                  profileId={d.id ?? null}
                />
              ) : null}
              {/*
                This tunnel wraps a GRAPHICAL session (VNC or RDP) inside an
                SSH login, so it can reach a server that only listens on the
                remote machine's own loopback. On an SSH host profile that
                reads as tunnelling SSH through SSH, which is not a real
                setting, the profile IS the SSH connection already. The two
                features sharing the words "SSH tunnel" is a naming
                collision, not a relationship, so it is worth spelling out
                here rather than leaving the omission to look accidental.
              */}
              {!isSsh ? (
                <SshTunnelSection
                  tunnel={d.sshTunnel}
                  passphrase={d.sshPassphrase}
                  onChange={(sshTunnel) => set({ sshTunnel })}
                  onPassphrase={(sshPassphrase) => set({ sshPassphrase })}
                />
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2.5 pt-1">
          {/*
            What is wrong, in words, when there is something wrong. The
            button used to be grey with no reason at all, and the reasons that
            live inside the collapsed "Advanced" section could not be seen
            without opening it.
          */}
          {blockers.length > 0 ? (
            <p className="me-auto self-center text-xs text-danger" role="alert">
              {blockers.join(" · ")}
            </p>
          ) : null}
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            {t("host.cancel")}
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t("host.saving") : d.isNew ? t("host.add") : t("host.saveChanges")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The RDP options that are ordinary preferences, inside Advanced.
 *
 * Everything that is a security decision lives in {@link SecuritySection}
 * below instead, so a person scanning Advanced for the resolution setting
 * does not meet a TLS downgrade switch on the way.
 */
function RdpOptionsSection({
  rdp,
  onChange,
}: {
  rdp: RdpSettings;
  onChange: (patch: Partial<RdpSettings>) => void;
}): ReactNode {
  const t = useT();
  const [codecs, setCodecs] = useState(false);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("host.colourDepth")} hint={t("host.colourDepthHint")}>
          <Select
            value={rdp.colorDepth}
            onChange={(e) => onChange({ colorDepth: e.target.value as RdpSettings["colorDepth"] })}
          >
            <option value="auto">{t("host.auto")}</option>
            <option value="bpp32">{t("host.bits32")}</option>
            <option value="bpp24">{t("host.bits24")}</option>
            <option value="bpp16">{t("host.bits16")}</option>
            <option value="bpp15">{t("host.bits15")}</option>
          </Select>
        </Field>
        <Field label={t("host.sound")}>
          <Select
            value={rdp.audio}
            onChange={(e) => onChange({ audio: e.target.value as RdpSettings["audio"] })}
          >
            <option value="play-locally">{t("host.soundHere")}</option>
            <option value="leave-at-server">{t("host.soundThere")}</option>
            <option value="off">{t("host.soundOff")}</option>
          </Select>
        </Field>
      </div>

      <Check
        checked={rdp.monitors === "all"}
        onChange={(on) => onChange({ monitors: on ? "all" : "primary" })}
        label={t("host.allMonitors")}
        hint={t("host.allMonitorsHint")}
      />
      <ResolutionField value={rdp.resolution} onChange={(resolution) => onChange({ resolution })} />
      <Check
        checked={rdp.clipboard}
        onChange={(clipboard) => onChange({ clipboard })}
        label={t("host.shareClipboard")}
      />
      <Check
        checked={rdp.consoleSession}
        onChange={(consoleSession) => onChange({ consoleSession })}
        label={t("host.consoleSession")}
      />

      <div className="rounded-md border border-subtle">
        <button
          type="button"
          aria-expanded={codecs}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium text-secondary hover:text-primary"
          onClick={() => setCodecs((v) => !v)}
        >
          {codecs ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          {t("host.codecs")}
        </button>
        {codecs ? (
          <div className="space-y-3 border-t border-subtle p-3">
            <p className="text-xs text-tertiary">{t("host.codecsHint")}</p>
            {(
              [
                ["remotefx", "RemoteFX"],
                ["clearcodec", "ClearCodec"],
                ["planar", "Planar"],
                ["avc420", "H.264 (AVC 4:2:0)"],
              ] as const
            ).map(([key, label]) => (
              <Check
                key={key}
                checked={rdp.codecs[key]}
                onChange={(on) => onChange({ codecs: { ...rdp.codecs, [key]: on } })}
                label={label}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** `[A-Za-z0-9_-]`, 1 to 64 characters, matching the Rust side exactly.
 *  The name is pasted onto a remote command line to attach or create the
 *  multiplexer session, so anything else is a shell-injection surface, not
 *  a cosmetic preference, and this has to refuse what the Rust side refuses. */
const SESSION_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** `null` when the session name is fine to save. */
function sessionNameError(name: string, t: Translate): string | null {
  if (name.trim() === "") return t("host.required");
  if (name.length > 64) return t("host.max64");
  if (!SESSION_NAME_RE.test(name)) return t("host.sessionNameChars");
  return null;
}

/**
 * `is_safe_distro_name` in `crates/ssh-core/src/multiplexer.rs`, mirrored
 * exactly: real distro names carry dots (`Ubuntu-22.04`, `openSUSE-Leap-15.5`)
 * so this is looser than {@link SESSION_NAME_RE}, but the name still reaches
 * the remote inside a command line, so anything a shell would treat as
 * punctuation stays out.
 */
const DISTRO_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** `null` when a typed distribution name is fine to save. Empty is legal, it
 *  means the Windows default, so only a non-empty, invalid name is an error. */
function distroNameError(name: string, t: Translate): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return null;
  if (trimmed.length > 64) return t("host.max64");
  if (!DISTRO_NAME_RE.test(trimmed)) return t("host.distroNameChars");
  return null;
}

/**
 * `parse_mac` in `crates/vnc-discovery/src/wol.rs`, mirrored exactly: twelve
 * hex digits, with `:` `-` `.` and spaces ignored between them.
 *
 * The Rust side refuses a bad address, but it does it when the person presses
 * "Wake", long after the profile was saved. Mirroring the rule here means a
 * typo is caught while it is being typed, rather than on the one evening the
 * person needed the machine to be awake.
 */
function macAddressError(value: string | null, t: Translate): string | null {
  const raw = (value ?? "").trim();
  if (raw === "") return null;
  const cleaned = raw.replace(/[:.\- ]/g, "");
  if (cleaned.length !== 12 || !/^[0-9a-fA-F]{12}$/.test(cleaned)) {
    return t("host.macFormat");
  }
  return null;
}

/**
 * ssh.ts's `SshAuthKind` has a `"password"` member because that is a real
 * choice in the host editor; the connect config's own `SshAuthKind` (in
 * tauri.ts) does not, because "password" and "key-file passphrase" are the
 * same thing to the Rust side once they are looked up: whatever is sitting
 * in this profile's keychain entry, which is what `"stored"` fetches. Without
 * this mapping the Detect button would send a value `ssh_list_wsl_distros`
 * does not know and the request would fail to deserialize.
 */
function toDetectAuth(auth: SshAuthKind): "stored" | "key-file" | "agent" {
  return auth === "password" ? "stored" : auth;
}

/**
 * The SSH-only options, inside Advanced, shown only for the SSH protocol.
 *
 * Mirrors {@link RdpOptionsSection}'s shape: everything here is an ordinary
 * preference, not a security decision, so it lives in one flat block rather
 * than behind its own disclosure.
 *
 * Authentication used to be the first thing in here and is not any more: it
 * is the difference between connecting and not connecting, which is not an
 * advanced preference, so it lives in the main form beside the password it
 * governs. What is left is genuinely optional. The auth *kind* is still read
 * here, by {@link toDetectAuth}, because Detect has to connect the same way
 * the profile will.
 */
function SshOptionsSection({
  ssh,
  onChange,
  host,
  port,
  username,
  profileId,
}: {
  ssh: SshSettings;
  onChange: (patch: Partial<SshSettings>) => void;
  /** The draft's own connection fields, so Detect can ask about the machine
   *  this profile actually points at rather than a stale or saved one. */
  host: string;
  port: number;
  username: string;
  profileId: string | null;
}): ReactNode {
  // Touched on blur rather than checked from the first keystroke, the same
  // rule the address field uses: typing a fresh name a character at a time
  // must not flash red before the user has finished it.
  const t = useT();
  const [nameTouched, setNameTouched] = useState(false);
  const nameError = nameTouched ? sessionNameError(ssh.sessionName, t) : null;

  // `null` means Detect has never run this dialog session: show the free-text
  // field with no "could not read" line, since nothing has actually failed
  // yet. `[]` means it ran and came back empty, which is an ordinary answer,
  // not an error, so the free-text field stays but says why.
  const [distros, setDistros] = useState<string[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [distroTouched, setDistroTouched] = useState(false);
  const distroError = distroTouched ? distroNameError(ssh.wslDistro ?? "", t) : null;

  const detectDistros = async (): Promise<void> => {
    setDetecting(true);
    try {
      const found = await sshListWslDistros({
        host,
        port,
        username,
        auth: toDetectAuth(ssh.auth),
        keyPath: ssh.keyPath,
        profileId,
      });
      setDistros(found);
    } finally {
      setDetecting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/*
        Sits directly after Authentication and before the multiplexer below,
        because it decides WHERE the multiplexer is looked for, not just
        whether one is used: with this on, tmux/psmux/etc. are searched for
        inside the WSL distribution, not on Windows. The reader needs that
        before reading the multiplexer control, or the multiplexer choice
        looks like it is about the Windows side when it may not be.
      */}
      <Check
        checked={ssh.wsl}
        onChange={(wsl) => onChange({ wsl })}
        label={t("host.wsl")}
        hint={t("host.wslHint")}
      />

      {ssh.wsl ? (
        <Field
          label={t("host.distribution")}
          error={distroError}
          hint={
            distros !== null && distros.length === 0
              ? t("host.distrosUnreadable")
              : t("host.defaultDistribution")
          }
        >
          <div className="flex gap-2">
            {distros !== null && distros.length > 0 ? (
              <Select
                value={ssh.wslDistro ?? ""}
                onChange={(e) => onChange({ wslDistro: e.target.value || null })}
              >
                <option value="">{t("host.defaultDistributionOption")}</option>
                {distros.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            ) : (
              <input
                className="field mono"
                value={ssh.wslDistro ?? ""}
                placeholder={t("host.defaultDistributionOption")}
                maxLength={64}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                onBlur={() => setDistroTouched(true)}
                onChange={(e) => onChange({ wslDistro: e.target.value || null })}
              />
            )}
            <button
              type="button"
              className="btn-secondary shrink-0 disabled:opacity-40"
              disabled={detecting}
              onClick={() => void detectDistros()}
            >
              {detecting ? t("host.detecting") : t("host.detect")}
            </button>
          </div>
        </Field>
      ) : null}

      {/*
        This is the most consequential control in the section: it decides
        whether the remote work survives a dropped connection at all, so the
        hint says that in plain language rather than naming the mechanism
        and leaving the stakes implicit. psmux is named beside tmux, not
        after it, because it is not a fallback for tmux, it is the author's
        own tmux-compatible multiplexer for Windows and the one most likely
        to be the only option on a Windows box.
      */}
      <Field
        label={t("host.multiplexer")}
        hint={t("host.multiplexerHint")}
      >
        <Select
          value={ssh.multiplexer}
          onChange={(e) => onChange({ multiplexer: e.target.value as MultiplexerKind })}
        >
          <option value="auto">{t("host.multiplexerAuto")}</option>
          <option value="psmux">psmux</option>
          <option value="tmux">tmux</option>
          <option value="screen">screen</option>
          <option value="zellij">zellij</option>
          <option value="none">{t("host.multiplexerNone")}</option>
          <option value="custom">{t("host.customCommand")}</option>
        </Select>
      </Field>

      <Field
        label={t("host.sessionName")}
        error={nameError}
        hint={t("host.sessionNameHint")}
      >
        <input
          className="field mono"
          value={ssh.sessionName}
          maxLength={64}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onBlur={() => setNameTouched(true)}
          onChange={(e) => onChange({ sessionName: e.target.value })}
        />
      </Field>

      {ssh.multiplexer === "custom" ? (
        <Field
          label={t("host.customCommand")}
          hint={t("host.customCommandHint")}
        >
          <input
            className="field mono"
            value={ssh.customCommand ?? ""}
            placeholder="tmux new -A -s {session}"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            onChange={(e) => onChange({ customCommand: e.target.value || null })}
          />
        </Field>
      ) : null}

      <Field
        label={t("host.startupCommand")}
        hint={t("host.startupCommandHint")}
      >
        <input
          className="field mono"
          value={ssh.startupCommand ?? ""}
          placeholder={t("host.optional")}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => onChange({ startupCommand: e.target.value || null })}
        />
      </Field>

      {/*
        Meaningless under Auto: Auto already treats "nothing installed" as an
        answer (fall back on its own) rather than a failure, so there is
        nothing here for this switch to decide. It only means something once
        the multiplexer is pinned to something that might not be there.
      */}
      {ssh.multiplexer !== "auto" ? (
        <Check
          checked={ssh.fallbackToShell}
          onChange={(fallbackToShell) => onChange({ fallbackToShell })}
          label={t("host.fallbackShell")}
          hint={t("host.fallbackShellHint")}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("host.fontSize")}>
          <input
            className="field"
            type="number"
            min={8}
            max={32}
            value={ssh.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) || ssh.fontSize })}
          />
        </Field>
        <Field label={t("host.scrollback")} hint={t("host.scrollbackHint")}>
          <input
            className="field"
            type="number"
            min={0}
            max={1_000_000}
            value={ssh.scrollback}
            onChange={(e) => onChange({ scrollback: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>
    </div>
  );
}

/**
 * The two switches that make the connection less safe, behind one heading, in
 * the same bordered block the SSH tunnel section uses.
 *
 * They are together and set apart on purpose. Both are relaxations, both are
 * off by default, and neither should be met by accident while looking for
 * something else. The disclosure opens by itself when either is already on.
 */
function SecuritySection({
  rdp,
  open,
  onToggle,
  onChange,
}: {
  rdp: RdpSettings;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<RdpSettings>) => void;
}): ReactNode {
  const t = useT();
  return (
    <div className="rounded-md border border-subtle">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium text-secondary hover:text-primary"
        onClick={onToggle}
      >
        {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        {t("host.security")}
      </button>
      {open ? (
        <div className="space-y-4 border-t border-subtle p-3">
          <Check
            checked={rdp.nla === "allow-fallback"}
            onChange={(on) => onChange({ nla: on ? "allow-fallback" : "required" })}
            label={t("host.allowNoNla")}
            hint={t("host.allowNoNlaHint")}
          />
          <div>
            <Check
              checked={rdp.legacyTls}
              onChange={(legacyTls) => onChange({ legacyTls })}
              label={t("host.allowLegacyTls")}
              hint={t("host.allowLegacyTlsHint")}
            />
            {/*
              Shown only while the box is ticked, in the same danger colour
              the address field uses for its error text.

              Five things about this copy are deliberate. It names the
              machines before the protocol versions, because somebody with a
              Server 2008 R2 box in a cupboard does not know which TLS
              versions it offers. It says what still holds, because "this is
              insecure" with nothing after it makes people either ignore the
              warning or abandon a connection they legitimately need, and the
              honest position is narrower than either. It does not promise
              safety. It is per host and says so by living in one host's
              editor. And it never appears for a VNC profile.
            */}
            {rdp.legacyTls ? (
              <p className="mt-2 text-xs text-danger" role="status">
                {t("host.legacyTlsWarning")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A checkbox with the label-and-hint shape this dialog uses everywhere. */
/** The select entry that opens the native file dialog. */
const BROWSE = "__browse__";

/**
 * Choose a private key: pick one this computer already has, or browse for it.
 *
 * This replaced a bare text box that wanted an absolute path typed from
 * memory, which is a fine control for somebody who knows their key is at
 * `~/.ssh/id_ed25519` and a dead end for everybody else. Almost every key on
 * a personal machine is in `~/.ssh`, so the list is nearly always the whole
 * answer; Browse is there for the key on a USB stick, and the path box for
 * the person who would rather type it anyway.
 *
 * The path field appears on its own whenever the chosen key is not one of
 * the listed ones, so a browsed or typed path is always visible and always
 * editable rather than hiding behind a select that cannot represent it.
 */
function KeyFileField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (path: string | null) => void;
}): ReactNode {
  const [found, setFound] = useState<LocalKeys>({ dir: "", keys: [] });
  // Sticky once the user has gone off-list: cancelling the file dialog, or
  // typing a path by hand, must not bounce the field back to the list and
  // silently re-select somebody else's key.
  const [manual, setManual] = useState(false);
  // In a plain browser there is no Rust side to ask, so the dev server shows
  // the same three-state list the real one would, exactly as the library
  // shows mock hosts.
  const mock = useMockData();
  const t = useT();

  useEffect(() => {
    let live = true;
    void sshListLocalKeys().then((keys) => {
      if (!live) return;
      setFound(mock ? { dir: "/Users/you/.ssh", keys: MOCK_LOCAL_KEYS } : keys);
    });
    return () => {
      live = false;
    };
  }, [mock]);

  const path = value ?? "";
  const chosen = found.keys.find((k) => k.path === path) ?? null;
  const offList = path !== "" && chosen === null;
  const showPath = manual || offList || found.keys.length === 0;

  const browse = async (): Promise<void> => {
    const picked = await pickPrivateKeyFile(found.dir);
    if (picked) {
      onChange(picked);
      setManual(false);
    }
  };

  return (
    <Field
      label={t("host.privateKey")}
      hint={
        chosen?.encrypted
          ? t("host.keyProtectedHint")
          : found.keys.length === 0
            ? t("host.keyOnDiskHint")
            : t("host.keysFoundHint")
      }
    >
      <div className="space-y-2">
        {found.keys.length > 0 ? (
          <div className="flex gap-2">
            <Select
              value={offList || manual ? BROWSE : path}
              onChange={(e) => {
                const picked = e.target.value;
                if (picked === BROWSE) {
                  setManual(true);
                  void browse();
                  return;
                }
                setManual(false);
                onChange(picked || null);
              }}
            >
              <option value="">{t("host.chooseKey")}</option>
              {found.keys.map((k) => (
                <option key={k.path} value={k.path}>
                  {keyLabel(k.name, k.kind, k.comment)}
                </option>
              ))}
              <option value={BROWSE}>{t("host.anotherFile")}</option>
            </Select>
            <button type="button" className="btn-secondary shrink-0" onClick={() => void browse()}>
              {t("host.browse")}
            </button>
          </div>
        ) : null}
        {showPath ? (
          <div className="flex gap-2">
            <input
              className="field mono"
              value={path}
              placeholder="~/.ssh/id_ed25519"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              aria-label={t("host.privateKeyPathAria")}
              onChange={(e) => {
                setManual(true);
                onChange(e.target.value || null);
              }}
            />
            {found.keys.length > 0 ? null : (
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => void browse()}
              >
                {t("host.browse")}
              </button>
            )}
          </div>
        ) : null}
      </div>
    </Field>
  );
}

/** `id_ed25519 (ed25519, gj@laptop)`: the file name, then whatever else there
 *  is to tell two generated names apart. */
function keyLabel(name: string, kind: string, comment: string | null): string {
  const extra = [kind, comment].filter((part) => part && part.length > 0);
  return extra.length > 0 ? `${name}  (${extra.join(", ")})` : name;
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint?: string;
}): ReactNode {
  return (
    <label className="flex items-start gap-2.5 text-sm text-primary">
      <input
        type="checkbox"
        className="mt-0.5 accent-(--accent)"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint ? <span className="block text-xs text-tertiary">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * The SSH tunnel editor inside Advanced. The auth secret itself never
 * appears here: `stored` uses the passphrase saved in the keychain for this
 * host (the same one the Files panel uses), `agent` asks the running
 * ssh-agent, and `key-file` names a key on disk.
 */
function SshTunnelSection({
  tunnel,
  passphrase,
  onChange,
  onPassphrase,
}: {
  tunnel: SshTunnelSettings | null;
  passphrase: string;
  onChange: (tunnel: SshTunnelSettings) => void;
  onPassphrase: (passphrase: string) => void;
}): ReactNode {
  const settings = tunnel ?? blankSshTunnel();
  const patch = (p: Partial<SshTunnelSettings>): void => onChange({ ...settings, ...p });
  const t = useT();

  return (
    <div className="space-y-4 rounded-md border border-subtle p-3">
      <label className="flex items-start gap-2.5 text-sm text-primary">
        <input
          type="checkbox"
          className="mt-0.5 accent-(--accent)"
          checked={settings.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        <span>
          {t("host.tunnelOverSsh")}
          <span className="block text-xs text-tertiary">{t("host.tunnelHint")}</span>
        </span>
      </label>
      {settings.enabled ? (
        <>
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <Field label={t("host.sshHost")} hint={t("host.sshHostHint")}>
              <input
                className="field mono"
                value={settings.host}
                placeholder={t("host.sameAsAddress")}
                spellCheck={false}
                onChange={(e) => patch({ host: e.target.value })}
              />
            </Field>
            <Field label={t("host.sshPort")}>
              <input
                className="field mono"
                type="number"
                min={1}
                max={65535}
                value={settings.port}
                onChange={(e) => {
                  // Clamped, like the main port field and for the same
                  // reason: this port is read as a `u16` out of the settings
                  // blob, so a value above 65535 does not fail this field, it
                  // fails the WHOLE blob, and the profile then refuses to
                  // connect with a message about settings nobody remembers
                  // changing. The browser's own `max` is a bubble, not a rule.
                  const typed = Number.parseInt(e.target.value, 10);
                  if (Number.isNaN(typed)) {
                    patch({ port: 22 });
                    return;
                  }
                  patch({ port: Math.min(65535, Math.max(1, typed)) });
                }}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("host.user")} hint={t("host.userHint")}>
              <input
                className="field mono"
                value={settings.user}
                placeholder={t("host.sameAsThisComputer")}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => patch({ user: e.target.value })}
              />
            </Field>
            <Field label={t("host.authentication")} hint={t("host.authHint")}>
              <Select
                value={settings.auth}
                onChange={(e) =>
                  patch({ auth: e.target.value as SshTunnelSettings["auth"] })
                }
              >
                <option value="stored">{t("host.authStored")}</option>
                <option value="agent">{t("host.sshAuthAgent")}</option>
                <option value="key-file">{t("host.authKeyFile")}</option>
              </Select>
            </Field>
          </div>
          {settings.auth === "key-file" ? (
            <KeyFileField
              value={settings.keyPath}
              onChange={(keyPath) => patch({ keyPath })}
            />
          ) : null}
          {settings.auth !== "agent" ? (
            <Field
              label={settings.auth === "key-file" ? t("host.keyPassphrase") : t("host.sshPassword")}
              hint={t("host.tunnelSecretHint")}
            >
              <input
                className="field"
                type="password"
                value={passphrase}
                placeholder={t("host.optional")}
                autoComplete="off"
                onChange={(e) => onPassphrase(e.target.value)}
              />
            </Field>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * The size of the remote desktop, as opposed to how it is scaled once it
 * arrives.
 *
 * One control rather than a size plus a "follow the window" checkbox: the two
 * are not independent, and a fixed size that also tracked the window would
 * stop being fixed as soon as the window moved.
 */
function ResolutionField({
  value,
  onChange,
}: {
  value: RdpResolution;
  onChange: (v: RdpResolution) => void;
}): ReactNode {
  const listed =
    value.mode === "fixed" &&
    RDP_FIXED_SIZES.some(([w, h]) => w === value.width && h === value.height);
  const selected =
    value.mode === "fixed" ? (listed ? `${value.width}x${value.height}` : "custom") : value.mode;

  const pick = (v: string): void => {
    if (v === "follow-window" || v === "window-at-connect") return onChange({ mode: v });
    if (v === "custom") {
      // Seed the boxes from whatever is on screen, so switching to Custom
      // does not blank the fields the user was just looking at.
      const [w, h] = value.mode === "fixed" ? [value.width, value.height] : [1920, 1080];
      return onChange({ mode: "fixed", width: w, height: h });
    }
    const [w, h] = v.split("x").map(Number);
    onChange({ mode: "fixed", width: w, height: h });
  };

  const custom = value.mode === "fixed" && !listed;
  const t = useT();
  // Held as a number so a half typed value does not snap; the profile is only
  // written when the dialog is saved, and the range is checked on read.
  //
  // The range is ALSO checked here, at the point of writing, and not only on
  // read: these two numbers are a `u16` inside the settings blob, so a value
  // outside the range does not fail this field, it fails the whole blob, and
  // the profile then refuses to connect with a message about settings nobody
  // remembers changing. The browser's own `max` is a bubble, not a rule.
  const dim = (n: number, set: (v: number) => void, label: string): ReactNode => (
    <input
      className="field"
      type="number"
      min={RDP_MIN_DIM}
      max={RDP_MAX_DIM}
      value={n}
      aria-label={label}
      onChange={(e) => {
        const typed = Number(e.target.value);
        if (!Number.isFinite(typed)) {
          set(0);
          return;
        }
        set(Math.min(RDP_MAX_DIM, Math.max(RDP_MIN_DIM, Math.trunc(typed))));
      }}
    />
  );

  return (
    <Field
      label={t("host.resolution")}
      hint={
        value.mode === "follow-window"
          ? t("host.resolutionFollowHint")
          : value.mode === "window-at-connect"
            ? t("host.resolutionAtConnectHint")
            : t("host.resolutionFixedHint")
      }
    >
      <Select value={selected} onChange={(e) => pick(e.target.value)}>
        <option value="window-at-connect">{t("host.resolutionAtConnect")}</option>
        <option value="follow-window">{t("host.resolutionFollow")}</option>
        {RDP_FIXED_SIZES.map(([w, h]) => (
          <option key={`${w}x${h}`} value={`${w}x${h}`}>
            {w} x {h}
          </option>
        ))}
        <option value="custom">{t("host.resolutionCustom")}</option>
      </Select>
      {custom && value.mode === "fixed" ? (
        <div className="mt-2 grid grid-cols-2 gap-3">
          {dim(value.width, (width) => onChange({ ...value, width }), t("host.widthPixels"))}
          {dim(value.height, (height) => onChange({ ...value, height }), t("host.heightPixels"))}
        </div>
      ) : null}
    </Field>
  );
}

function Field({
  label,
  hint,
  error,
  required,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  /** Marks the field as one that has to be filled in. */
  required?: boolean;
  /** Marks the field as one that does not have to be filled in. */
  optional?: boolean;
  children: ReactNode;
}): ReactNode {
  // The label is a label for the CONTROL and for nothing else.
  //
  // The label used to WRAP the control, the hint and the error together, so
  // the control's accessible name was all three: the address field was
  // announced as "Address, 192.168.1.42, or a name like office. A number
  // after the colon under 100 is a screen number, so :1 is screen 1 on port
  // 5901; 100 and above is a port." A name that long is a name nobody reads.
  //
  // So the label is associated with the control, and the hint and the error
  // are DESCRIPTIONS of it: a screen reader reads the name, then says the
  // description on request, and the error is announced when it appears.
  const id = useId();
  const t = useT();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id ?? id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })
    : children;
  return (
    <div className="block">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-secondary">
        {label}
        {/*
          The asterisk is for the eye. The requirement is announced by
          `aria-required` on the control, which is what a screen reader can
          act on, and a star on its own tells a person using a screen reader
          nothing at all.
        */}
        {required ? (
          <span className="ms-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
        {optional ? <span className="ms-1 text-tertiary">{t("field.optional")}</span> : null}
      </label>
      {control}
      {error ? (
        <span id={errorId} className="mt-1 block text-xs text-danger" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={hintId} className="mt-1 block text-xs text-tertiary">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
