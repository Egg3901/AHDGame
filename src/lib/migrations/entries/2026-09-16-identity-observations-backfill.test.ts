import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { buildBackfillRows } from "./2026-09-16-identity-observations-backfill";

const USER = new ObjectId();
const d = (day: number) => new Date(Date.UTC(2026, 7, day));

describe("buildBackfillRows", () => {
  it("dates the registration IP by createdAt", () => {
    const rows = buildBackfillRows({
      _id: USER,
      createdAt: d(1),
      updatedAt: d(9),
      registrationIp: "1.1.1.1",
    });
    const row = rows.find((r) => r.track === "ip" && r.value === "1.1.1.1");
    expect(row).toBeDefined();
    expect(row?.firstSeen).toEqual(d(1));
    expect(row?.datesKnown).toBe(true);
    expect(row?.source).toBe("backfill");
  });

  it("prefers lastKnownIpAt, then lastLogin, then createdAt for the last known IP", () => {
    const withStamp = buildBackfillRows({
      _id: USER,
      createdAt: d(1),
      updatedAt: d(9),
      lastKnownIp: "2.2.2.2",
      lastKnownIpAt: d(5),
      lastLogin: d(3),
    });
    expect(withStamp.find((r) => r.value === "2.2.2.2")?.lastSeen).toEqual(d(5));

    const withoutStamp = buildBackfillRows({
      _id: USER,
      createdAt: d(1),
      updatedAt: d(9),
      lastKnownIp: "2.2.2.2",
      lastLogin: d(3),
    });
    expect(withoutStamp.find((r) => r.value === "2.2.2.2")?.lastSeen).toEqual(d(3));

    const bare = buildBackfillRows({
      _id: USER,
      createdAt: d(1),
      updatedAt: d(9),
      lastKnownIp: "2.2.2.2",
    });
    expect(bare.find((r) => r.value === "2.2.2.2")?.lastSeen).toEqual(d(1));
  });

  it("marks undated fingerprintHistory entries and anchors them to updatedAt", () => {
    const rows = buildBackfillRows({
      _id: USER,
      createdAt: d(1),
      updatedAt: d(9),
      lastFingerprint: "current",
      lastFingerprintAt: d(8),
      fingerprintHistory: ["older1", "older2", "current"],
    });
    const older = rows.filter((r) => r.value.startsWith("older"));
    expect(older).toHaveLength(2);
    for (const row of older) {
      expect(row.datesKnown).toBe(false);
      expect(row.lastSeen).toEqual(d(9));
    }
    // "current" is already covered by lastFingerprint and must not be duplicated.
    expect(rows.filter((r) => r.value === "current")).toHaveLength(1);
    expect(rows.find((r) => r.value === "current")?.datesKnown).toBe(true);
  });

  it("drops sentinel and degenerate values", () => {
    const rows = buildBackfillRows({
      _id: USER,
      createdAt: d(1),
      updatedAt: d(9),
      registrationIp: "unknown",
      lastKnownIp: "127.0.0.1",
      registrationFingerprint: "server-side",
      fingerprintHistory: ["unknown", ""],
    });
    expect(rows).toHaveLength(0);
  });

  it("produces nothing for a user with no identity values", () => {
    expect(buildBackfillRows({ _id: USER, createdAt: d(1), updatedAt: d(9) })).toHaveLength(0);
  });

  it("does not cross-contaminate the two tracks when a value appears on both", () => {
    // A fingerprint hash and an IP can never collide in practice, but the dedupe
    // guard must key on (track, value) rather than value alone.
    const rows = buildBackfillRows({
      _id: USER,
      createdAt: d(1),
      updatedAt: d(9),
      registrationIp: "abcdef",
      registrationFingerprint: "abcdef",
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.track).sort()).toEqual(["fingerprint", "ip"]);
  });

  it("survives a malformed createdAt without throwing or inventing NaN dates", () => {
    const rows = buildBackfillRows({
      _id: USER,
      createdAt: new Date("not-a-date"),
      updatedAt: d(9),
      registrationIp: "1.1.1.1",
    });
    expect(rows).toHaveLength(1);
    expect(Number.isNaN(rows[0].firstSeen.getTime())).toBe(false);
    expect(rows[0].firstSeen).toEqual(d(9));
  });
});
