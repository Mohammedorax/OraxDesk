import { describe, expect, it } from "vitest";
import {
  helpCodeFromText,
  helpLink,
  isDeviceNumber,
  isLegacyInvitation,
  looksLikeHelpCode,
  registryErrorKind,
} from "./help";

describe("help codes", () => {
  it("strips the spaces and dashes people read out loud", () => {
    expect(helpCodeFromText("1234 5678 9012")).toBe("123456789012");
    expect(helpCodeFromText("1234-5678-9012")).toBe("123456789012");
  });

  it("reads the links the app shares", () => {
    expect(helpCodeFromText("oraxdesk://join/1234%205678%209012")).toBe("123456789012");
    expect(helpCodeFromText("oraxdesk://help?code=123456789012")).toBe("123456789012");
  });

  it("never mistakes a full invitation for a code", () => {
    const invitation = "boundary1:eyJ2ZXJzaW9uIjoxfQ";
    expect(isLegacyInvitation(invitation)).toBe(true);
    expect(helpCodeFromText(invitation)).toBe(invitation);
    expect(looksLikeHelpCode(invitation)).toBe(false);
  });

  it("recognises the link it builds", () => {
    expect(helpLink("1234 5678 9012")).toBe("oraxdesk://join/123456789012");
    expect(looksLikeHelpCode(helpLink("123456789012"))).toBe(true);
  });

  it("does not confuse a nine-digit device number with a help code", () => {
    expect(isDeviceNumber("250 739 098")).toBe(true);
    expect(looksLikeHelpCode("250739098")).toBe(true);
    expect(looksLikeHelpCode("short")).toBe(false);
  });
});

describe("registry error mapping", () => {
  it("recognises a clock problem before it becomes 'expired'", () => {
    expect(registryErrorKind("Request timestamp is outside the allowed window")).toBe("clock");
    expect(registryErrorKind("Invalid invitation expiry")).toBe("clock");
  });

  it("recognises a missing or used code", () => {
    expect(registryErrorKind("404 Not Found: No such device")).toBe("notFound");
    expect(registryErrorKind("unknown code")).toBe("notFound");
  });

  it("recognises a network failure", () => {
    expect(registryErrorKind("dns error: failed to lookup address")).toBe("network");
    expect(registryErrorKind("connection timed out")).toBe("network");
  });

  it("keeps an unknown failure unknown instead of blaming the network", () => {
    expect(registryErrorKind("the registry rejected this key")).toBe("other");
  });
});
