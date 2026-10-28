/**
 * Small, side-effect-free helpers for the beginner help flow.
 *
 * They live outside the components so the parsing and the error mapping can
 * be tested without mounting a dialog, and so the host and the helper agree
 * on what a code looks like.
 */

export type RegistryErrorKind = "clock" | "network" | "notFound" | "other";

/** A full invitation is the old, long form and is never treated as a code. */
export function isLegacyInvitation(text: string): boolean {
  return text.trim().startsWith("boundary1:");
}

/** A nine-digit device number, which is a different thing from a help code. */
export function isDeviceNumber(text: string): boolean {
  return /^\d{9}$/.test(compact(text));
}

function compact(text: string): string {
  return text.trim().replaceAll(" ", "").replaceAll("-", "");
}

/**
 * Turn what a person pasted into the code the registry understands.
 *
 * Accepts the code itself, a code with the spaces people read out loud, and
 * the `oraxdesk://join/<code>` / `oraxdesk://help?code=<code>` links the app
 * shares. A full invitation is left alone; the caller uses it as-is.
 */
export function helpCodeFromText(text: string): string {
  const trimmed = text.trim();
  if (trimmed === "" || isLegacyInvitation(trimmed)) return trimmed;
  const link = trimmed.match(/^oraxdesk:\/\/(?:join|help)(?:\/|\?code=)(.+)$/i);
  if (link) {
    try {
      return compact(decodeURIComponent(link[1]!));
    } catch {
      return compact(link[1]!);
    }
  }
  return compact(trimmed);
}

/** Whether this looks like a code we can send to the registry. */
export function looksLikeHelpCode(text: string): boolean {
  return /^[0-9A-Za-z_-]{6,32}$/.test(helpCodeFromText(text));
}

/** The `oraxdesk://` link a host can send instead of reading twelve digits. */
export function helpLink(code: string): string {
  return `oraxdesk://join/${encodeURIComponent(compact(code))}`;
}

/**
 * Say what went wrong in terms the person can act on.
 *
 * The registry and the Boundary layer use different words for the same
 * beginner-facing situations. A clock error is the one that used to say
 * "Invalid invitation expiry" and leave everyone guessing.
 */
export function registryErrorKind(error: unknown): RegistryErrorKind {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (
    /timestamp|clock|outside the allowed window|time (?:skew|sync)|invalid invitation expiry|no longer valid here|date and time/i.test(
      text,
    )
  ) {
    return "clock";
  }
  if (/\b404\b|not_found|no such device|not registered|unknown code|invalid code|code (?:is )?expired/i.test(text)) {
    return "notFound";
  }
  if (/network|dns|failed to connect|connection|timeout|timed out|unreachable|\b50[234]\b/i.test(text)) {
    return "network";
  }
  return "other";
}
