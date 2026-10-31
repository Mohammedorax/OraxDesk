/**
 * Turning a terminal disconnect reason into a sentence a person can act on.
 *
 * These two functions were module-private in `screens/Session.tsx`. They are
 * pure string-to-string with no React in them; they were in a component file
 * by history rather than by design, and the vitest `include` pattern does not
 * collect `.tsx`, so nothing could test the branch ordering that all of this
 * depends on.
 *
 * The shape is a chain of substring tests over a lowercased reason, ordered
 * so a more specific reading wins over a more general one. The input is
 * coerced before `toLowerCase` for a real reason: a payload arriving without
 * a reason once threw during render and unmounted the tree.
 *
 * Where a reason carries a stable lowercase symbol the workspace owns
 * (`nla-refused`, `legacy-tls-required`), the test matches that symbol rather
 * than prose somebody may reword. Where the driver currently sends only its
 * English sentence, a distinctive fragment of that sentence is matched too,
 * so the copy works today and keeps working once the symbol is carried.
 *
 * The symbol is now carried: `SessionState::Disconnected` has one, the
 * protocol fills it in, and it reaches here. It used to be dropped on the way
 * out of the event decoder, which made every branch below that matches on a
 * symbol dead code, and the person was shown the raw sentence from the
 * protocol instead of the explanation written for it.
 *
 * WHAT IT RETURNS
 *
 * A KEY, not a sentence. This is the text a person reads when a connection
 * FAILS, which is the last place an English sentence belongs in an app whose
 * default language is Arabic. The reason itself is a value from the shell and
 * stays as it is; the explanation around it is ours and is in the catalogue.
 */

import type { MessageKey } from "./i18n";

/**
 * The Boundary driver's name for "the invitation this session was opened
 * with is spent" (`crates/boundary-driver/src/lib.rs`, `terminal_symbol`).
 *
 * A support code is single use: it was spent when the session opened it, so
 * no reconnect can ever succeed — only a NEW code from the person being
 * helped can open another session. The disconnect panel matches this symbol
 * and offers that entry instead of a reconnect.
 */
export const INVITATION_SPENT = "invitation-spent";

/**
 * What to say, and the values to say it with.
 *
 * `args` is for the one case where the sentence has to name something: the
 * shell's own reason, which is a value and not a sentence of ours.
 */
export interface Diagnosis {
  key: MessageKey;
  args?: Record<string, string>;
}

/**
 * Would offering "reconnect" here re-prompt for a credential?
 *
 * It decides whether the reconnect affordance offers to ask again. Getting
 * this wrong is expensive in one specific direction: re-prompting after a
 * refusal nothing the user types can fix walks them through typing a
 * password three times into an Active Directory lockout counter.
 */
export function isAuthFailure(reason: string, symbol?: string | null): boolean {
  const r = reason.toLowerCase();
  // Neither of these can be fixed by typing a different password, and both
  // contain words the generic tests below would otherwise catch: the policy
  // refusal mentions authentication, and both legacy TLS symbols contain
  // "tls". Checked first, and explicitly, because the alternative is that a
  // future symbol containing the word "auth" silently changes what the
  // button does and no test fails.
  if (
    symbol === "ntlm-refused-by-policy" ||
    symbol === "legacy-tls-required" ||
    symbol === "legacy-tls-unavailable" ||
    symbol === "nla-refused" ||
    // A spent invitation cannot be fixed by typing a password: the code is
    // gone and only a new one opens another session. Offering the reprompt
    // here would walk somebody through an authentication nothing they type
    // can complete.
    symbol === INVITATION_SPENT ||
    r.includes("ntlm-refused-by-policy") ||
    r.includes("legacy-tls-required") ||
    r.includes("legacy-tls-unavailable") ||
    r.includes("nla-refused") ||
    r.includes("would not accept network level authentication")
  ) {
    return false;
  }
  if (r.includes("cancel")) return true;
  return r.includes("auth") || r.includes("password") || r.includes("credential");
}

export function diagnose(reason: unknown, symbol?: string | null): Diagnosis {
  const text = typeof reason === "string" ? reason : "";
  const r = text.toLowerCase();
  // Ordered FIRST: when the protocol says the invitation is spent, that is
  // what decides what happens next whatever the prose reads like — the
  // person being helped may have "cancelled", the link may have been
  // "reset" — and the answer is a new code, not a retry.
  if (symbol === INVITATION_SPENT) return { key: "diagnose.invitationSpent" };
  // Ordered: "cancelled" must win over the generic auth match below, or
  // dismissing the password prompt would be reported as a failed login.
  if (r.includes("cancel")) return { key: "diagnose.cancelled" };

  // Ordered above the generic password match for the same reason "cancel"
  // is: a message that mentions authentication and a domain policy must not
  // be reported as a wrong password. The two deserve opposite advice, and
  // the wrong one wastes an afternoon.
  if (symbol === "ntlm-refused-by-policy" || r.includes("ntlm-refused-by-policy")) {
    return { key: "diagnose.ntlmRefused" };
  }
  if (
    symbol === "nla-refused" ||
    r.includes("nla-refused") ||
    r.includes("would not accept network level authentication")
  ) {
    return { key: "diagnose.nlaRefused" };
  }

  // Ordered ABOVE the certificate/TLS arm below, which would otherwise
  // swallow both of these: the symbols contain the substring "tls".
  if (symbol === "legacy-tls-required" || r.includes("legacy-tls-required")) {
    return { key: "diagnose.legacyTlsRequired" };
  }
  if (symbol === "legacy-tls-unavailable" || r.includes("legacy-tls-unavailable")) {
    return { key: "diagnose.legacyTlsUnavailable" };
  }

  // Both SSH host-key messages, above every generic arm below: the changed
  // one contains "changed" and the unknown one names a key type, and either
  // would otherwise fall through as the raw sentence from the core, which is
  // a fingerprint and a colon and no advice at all.
  //
  // First contact normally never reaches here, it becomes the trust prompt
  // before a session is spawned. When it does reach here (a terminal beside
  // a session, a message that arrived some other way), reconnecting is what
  // raises that prompt, so that is what this says to do.
  if (r.includes("unknown ssh host key")) {
    return { key: "diagnose.unknownHostKey" };
  }
  if (r.includes("host key") && r.includes("changed")) {
    return { key: "diagnose.hostKeyChanged" };
  }

  // The diagnosis is about the port, not about which server ought to be on
  // it, so it does not name a protocol.
  //
  // "Refused" on its own is not enough. The RDP side says "the server
  // refused the requested security protocols" when the machine is there and
  // answered, but will not do security this client speaks, and a bare
  // substring test reported that as "nothing is listening on that port",
  // which sends the person to check a port that is very much open.
  if (r.includes("refused the requested security protocols")) {
    return { key: "diagnose.securityRefused" };
  }
  if (r.includes("connection refused") || r === "refused" || r.endsWith(" refused")) {
    return { key: "diagnose.refused" };
  }
  if (r.includes("timed out") || r.includes("timeout")) return { key: "diagnose.timedOut" };
  // Deliberately NOT a bare "auth" match. That caught every message merely
  // mentioning authentication, so a server offering none at all was reported
  // to the user as "incorrect password" for a server that has no password
  // (issue #1). Match only what really means "the credentials were rejected".
  if (
    r.includes("password") ||
    r.includes("authentication failed") ||
    r.includes("auth failed")
  ) {
    return { key: "diagnose.badPassword" };
  }
  if (r.includes("certificate") || r.includes("tls")) return { key: "diagnose.tlsUnverified" };
  if (r.includes("reset")) return { key: "diagnose.reset" };
  // The shell's own reason is a VALUE and is shown as it is; the sentence
  // around it is ours.
  return text
    ? { key: "diagnose.endedWith", args: { reason: text } }
    : { key: "diagnose.ended" };
}

/**
 * Does this failure have a fix in the host editor's Security section?
 *
 * The disconnect panel offers a button that opens the editor with Advanced
 * and Security already expanded, which is the same "open it expanded" rule
 * the editor applies to a setting that is already on.
 */
export function opensSecuritySettings(reason: string, symbol?: string | null): boolean {
  const r = reason.toLowerCase();
  return (
    symbol === "legacy-tls-required" ||
    symbol === "nla-refused" ||
    r.includes("legacy-tls-required") ||
    r.includes("nla-refused") ||
    r.includes("would not accept network level authentication")
  );
}
