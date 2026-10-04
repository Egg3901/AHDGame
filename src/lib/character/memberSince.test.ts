import { describe, expect, it } from "vitest";
import { resolveMemberSince } from "./memberSince";

const historyStartedAt = new Date("2026-01-01T12:00:00Z");
const profileCreatedAt = new Date("2026-08-08T21:00:00Z");

describe("account membership dates", () => {
  it("keeps the account join date when a new iteration creates a new profile", () => {
    const accountCreatedAt = new Date("2026-02-04T09:00:00Z");
    for (const profileDate of [profileCreatedAt, new Date("2027-02-01T12:00:00Z")]) {
      expect(
        resolveMemberSince({ accountCreatedAt, profileCreatedAt: profileDate, historyStartedAt })
      ).toEqual({ date: accountCreatedAt, isApproximate: false });
    }
  });

  it("marks accounts on the first surviving history day, even later that day", () => {
    const accountCreatedAt = new Date("2026-01-01T23:59:59Z");
    expect(resolveMemberSince({ accountCreatedAt, profileCreatedAt, historyStartedAt })).toEqual({
      date: accountCreatedAt,
      isApproximate: true,
    });
  });

  it("marks an account older than the surviving world record", () => {
    expect(
      resolveMemberSince({
        accountCreatedAt: new Date("2025-12-31T12:00:00Z"),
        profileCreatedAt,
        historyStartedAt,
      }).isApproximate
    ).toBe(true);
  });

  it("does not mark a later account just because its profile was created on reset day", () => {
    expect(
      resolveMemberSince({
        accountCreatedAt: new Date("2026-01-02T00:00:00Z"),
        profileCreatedAt,
        historyStartedAt,
      }).isApproximate
    ).toBe(false);
  });

  it.each([undefined, null, "invalid", new Date(NaN)])(
    "treats unavailable account dates (%s) as a profile-only lower bound",
    (accountCreatedAt) => {
      expect(resolveMemberSince({ accountCreatedAt, profileCreatedAt, historyStartedAt })).toEqual({
        date: profileCreatedAt,
        isApproximate: true,
      });
    }
  );

  it("accepts serialized timestamps and compares UTC days rather than local time", () => {
    expect(
      resolveMemberSince({
        accountCreatedAt: "2026-01-02T01:00:00+02:00",
        profileCreatedAt,
        historyStartedAt: historyStartedAt.toISOString(),
      })
    ).toEqual({ date: new Date("2026-01-01T23:00:00Z"), isApproximate: true });
  });

  it("keeps a valid join date precise when the history boundary is unavailable", () => {
    const accountCreatedAt = new Date("2026-02-04T09:00:00Z");
    expect(
      resolveMemberSince({ accountCreatedAt, profileCreatedAt, historyStartedAt: "invalid" })
    ).toEqual({ date: accountCreatedAt, isApproximate: false });
  });
});
