import { describe, expect, it } from "vitest";
import {
  decideProviderLink,
  decideProviderUnlink,
  hasUsablePassword,
  linkedProviderId,
  providerWriteSnapshotFilter,
} from "./providerCredentialWrite";

describe("provider credential write guards", () => {
  it("treats only non-empty passwords and provider ids as usable", () => {
    expect(hasUsablePassword({ password: "digest" })).toBe(true);
    for (const password of ["", undefined, null]) {
      expect(hasUsablePassword({ password: password as unknown as string })).toBe(false);
    }
    expect(linkedProviderId({ googleId: "g1" }, "google")).toBe("g1");
    for (const googleId of ["", undefined, null]) {
      expect(linkedProviderId({ googleId: googleId as unknown as string }, "google")).toBe(null);
    }
  });

  it("pins the exact credential and revocation snapshot", () => {
    const cutoff = new Date("2026-01-01T00:00:00Z");
    expect(
      providerWriteSnapshotFilter({
        password: "digest",
        googleId: undefined,
        discordId: "d1",
        authRevokedAt: cutoff,
      })
    ).toEqual({
      password: "digest",
      googleId: { $exists: false },
      discordId: "d1",
      isBanned: { $ne: true },
      authRevokedAt: cutoff,
    });
    expect(
      providerWriteSnapshotFilter({
        password: "",
        googleId: "g1",
        discordId: undefined,
        authRevokedAt: undefined,
      })
    ).toMatchObject({
      discordId: { $exists: false },
      authRevokedAt: { $exists: false },
    });
  });

  it("requires explicit unlink before replacing a different link", () => {
    expect(decideProviderLink({ googleId: undefined }, "google", "g1")).toEqual({
      ok: true,
      mode: "link",
    });
    expect(decideProviderLink({ googleId: "g1" }, "google", "g1")).toEqual({
      ok: true,
      mode: "idempotent",
    });
    expect(decideProviderLink({ googleId: "g2" }, "google", "g1")).toEqual({
      ok: false,
      reason: "conflict",
    });
  });

  it("rejects unlink of the last usable login method but stays idempotent", () => {
    expect(decideProviderUnlink({ password: "", googleId: "g1" }, "google")).toEqual({
      ok: false,
      reason: "last_method",
    });
    expect(decideProviderUnlink({ password: "", discordId: "d1" }, "google")).toEqual({
      ok: false,
      reason: "not_linked",
    });
    expect(decideProviderUnlink({ password: "digest", googleId: "g1" }, "google")).toEqual({
      ok: true,
      linkedId: "g1",
    });
    expect(
      decideProviderUnlink({ password: "", googleId: "g1", discordId: "d1" }, "google")
    ).toEqual({ ok: true, linkedId: "g1" });
  });
});
