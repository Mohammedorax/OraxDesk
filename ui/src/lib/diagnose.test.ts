import { describe, expect, it } from "vitest";
import { diagnose, INVITATION_SPENT, isAuthFailure } from "./diagnose";
import { translatorFor } from "./i18n";

/**
 * The invitation a support session is opened with is single use, and the
 * driver says so with a symbol rather than a sentence (`invitation-spent`,
 * `crates/boundary-driver/src/lib.rs`). What the disconnect panel then shows
 * and offers — a new code, never a reconnect — is decided from that symbol.
 */
describe("a spent invitation", () => {
  const en = translatorFor("en");
  const ar = translatorFor("ar");
  const said = (reason: unknown, symbol?: string | null): string => {
    const diagnosis = diagnose(reason, symbol);
    return en(diagnosis.key, diagnosis.args);
  };

  it("says the code is spent, whatever the prose reads like", () => {
    // The person being helped may have "cancelled" and the link may have
    // been "reset"; the fact that decides what happens next is that the code
    // was single use, and it wins over every prose match below it.
    expect(diagnose("cancelled by the person at that computer", INVITATION_SPENT).key).toBe(
      "diagnose.invitationSpent",
    );
    expect(diagnose("connection reset by peer", INVITATION_SPENT).key).toBe(
      "diagnose.invitationSpent",
    );
    expect(said("the link went away", INVITATION_SPENT)).toContain("new code");
  });

  it("keeps an ordinary cancellation reading ordinary without the symbol", () => {
    // The symbol carries the fact. Prose alone must not swallow a real
    // cancellation into the invitation copy.
    expect(diagnose("authentication was cancelled").key).toBe("diagnose.cancelled");
  });

  it("is never treated as a password problem", () => {
    // No password can reopen a spent code, so the panel must not offer a
    // reconnect that would ask for one.
    expect(isAuthFailure("the password was rejected", INVITATION_SPENT)).toBe(false);
  });

  it("is written in both catalogues", () => {
    // The panel renders these keys in whichever language is in force; a key
    // present in only one shows the other as the key's own name.
    for (const t of [ar, en]) {
      expect(t("diagnose.invitationSpent")).not.toBe("diagnose.invitationSpent");
      expect(t("overlay.newCode")).not.toBe("overlay.newCode");
    }
  });
});
