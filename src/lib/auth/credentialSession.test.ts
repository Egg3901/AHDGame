import { describe, expect, it } from "vitest";
import { credentialSessionIsCurrent } from "./credentialSession";

const userId = "000000000000000000000001";
const payload = {
  userId,
  username: "synthetic",
  email: "synthetic@example.invalid",
  role: "user",
  iat: 100,
};

describe("fresh credential session proof", () => {
  it("accepts legacy missing or null cutoffs and a cutoff strictly before issue time", () => {
    for (const authRevokedAt of [undefined, null, new Date(99_999)]) {
      expect(credentialSessionIsCurrent(userId, { authRevokedAt }, payload)).toBe(true);
    }
  });

  it("rejects the exact issue-time boundary and later revocation", () => {
    for (const authRevokedAt of [new Date(100_000), new Date(100_001)]) {
      expect(credentialSessionIsCurrent(userId, { authRevokedAt }, payload)).toBe(false);
    }
  });

  it("rejects malformed stored cutoffs without coercing them", () => {
    for (const authRevokedAt of [0, "1970-01-01", new Date(NaN), {}]) {
      expect(credentialSessionIsCurrent(userId, { authRevokedAt }, payload)).toBe(false);
    }
  });

  it("rejects missing proof, wrong account, banned account and invalid issue time", () => {
    expect(credentialSessionIsCurrent(userId, {}, null)).toBe(false);
    expect(credentialSessionIsCurrent("different", {}, payload)).toBe(false);
    expect(credentialSessionIsCurrent(userId, { isBanned: true }, payload)).toBe(false);
    for (const iat of [undefined, NaN, Infinity, -1, 1.5]) {
      expect(credentialSessionIsCurrent(userId, {}, { ...payload, iat })).toBe(false);
    }
  });
});
