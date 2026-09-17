import { describe, expect, it } from "vitest";
import {
  AUTH_MIGRATION_FENCE_FIELD,
  authMigrationFenceAbsentFilter,
  isAuthMigrationFenced,
} from "./sourceFence";
import { credentialSessionIsCurrent } from "./credentialSession";
import { providerWriteSnapshotFilter } from "./providerCredentialWrite";

describe("source migration fence", () => {
  it("uses the authMigrationFence field with an absent-field filter", () => {
    expect(AUTH_MIGRATION_FENCE_FIELD).toBe("authMigrationFence");
    expect(authMigrationFenceAbsentFilter()).toEqual({
      authMigrationFence: { $exists: false },
    });
  });

  it("treats only an absent field as unfenced", () => {
    expect(isAuthMigrationFenced(undefined)).toBe(false);
    expect(isAuthMigrationFenced(null)).toBe(false);
    expect(isAuthMigrationFenced({})).toBe(false);
    expect(isAuthMigrationFenced({ authMigrationFence: undefined })).toBe(true);
  });

  it("treats any present value, including malformed and null, as fenced", () => {
    for (const authMigrationFence of [null, {}, { operationId: "op" }, "fenced", 1, true, []]) {
      expect(isAuthMigrationFenced({ authMigrationFence })).toBe(true);
    }
  });

  it("denies the credential session for fenced accounts with otherwise valid tokens", () => {
    const payload = { userId: "u1", email: "a@b.c", username: "u", role: "user", iat: 10 };
    expect(credentialSessionIsCurrent("u1", { authMigrationFence: { op: 1 } }, payload)).toBe(
      false
    );
    expect(credentialSessionIsCurrent("u1", { authMigrationFence: null }, payload)).toBe(false);
    expect(credentialSessionIsCurrent("u1", {}, payload)).toBe(true);
  });

  it("pins fence absence on provider write filters so a concurrent fence matches zero", () => {
    const filter = providerWriteSnapshotFilter({
      password: "digest",
      googleId: undefined,
      discordId: "d1",
      authRevokedAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(filter).toMatchObject({ authMigrationFence: { $exists: false } });
    // A fenced snapshot still compiles to the absent filter: the write, not
    // the filter shape, is what denies.
    const fencedFilter = providerWriteSnapshotFilter({
      password: "digest",
      googleId: undefined,
      discordId: undefined,
      authRevokedAt: undefined,
      authMigrationFence: { op: 1 },
    });
    expect(fencedFilter).toMatchObject({ authMigrationFence: { $exists: false } });
  });
});
