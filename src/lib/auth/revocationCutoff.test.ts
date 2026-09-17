import { describe, expect, it } from "vitest";
import { isTokenRevokedByCutoff } from "./revocationCutoff";

describe("revocation cutoff validation", () => {
  it.each([0, false, "", "2026-01-01", {}, [], new Date(NaN)])(
    "denies malformed stored cutoff %j",
    (cutoff) => expect(isTokenRevokedByCutoff(cutoff, 100)).toBe(true)
  );
  it.each([undefined, null])("accepts an absent cutoff %j", (cutoff) => {
    expect(isTokenRevokedByCutoff(cutoff, 100)).toBe(false);
  });
  it.each([undefined, NaN, Infinity, -1, 100.5, "100"])(
    "denies an invalid issue time with a cutoff %j",
    (iat) => expect(isTokenRevokedByCutoff(new Date(0), iat)).toBe(true)
  );
  it("keeps the inclusive millisecond boundary", () => {
    expect(isTokenRevokedByCutoff(new Date(100000), 100)).toBe(true);
    expect(isTokenRevokedByCutoff(new Date(100001), 100)).toBe(true);
    expect(isTokenRevokedByCutoff(new Date(99999), 100)).toBe(false);
  });
});
