import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { buildSuspiciousPage, type RawSuspicious } from "./suspiciousList";

function entry(overrides: Partial<RawSuspicious> = {}): RawSuspicious {
  const id = overrides._id ?? new ObjectId();
  return {
    _id: id,
    characterId: overrides.characterId ?? new ObjectId(),
    userId: overrides.userId ?? new ObjectId(),
    characterName: "Char",
    username: "user",
    countryId: "US",
    flags: [],
    flagCount: overrides.flagCount ?? 1,
    highestSeverity: overrides.highestSeverity ?? "low",
    lastUpdated: new Date(),
    dismissed: overrides.dismissed ?? false,
    pool: overrides.pool ?? "active",
    ...overrides,
  } as RawSuspicious;
}

describe("buildSuspiciousPage", () => {
  it("marks accountDeleted when character OR user id is missing", () => {
    const liveChar = new ObjectId();
    const liveUser = new ObjectId();
    const live = entry({ characterId: liveChar, userId: liveUser });
    const deletedChar = entry({ userId: liveUser }); // its characterId not in set
    const result = buildSuspiciousPage({
      entries: [live, deletedChar],
      existingCharIds: new Set([liveChar.toHexString()]),
      existingUserIds: new Set([liveUser.toHexString()]),
      severity: undefined,
      deleted: false,
      showResolved: false,
      cursor: null,
      limit: 25,
    });
    // default deleted=false excludes the orphaned entry
    expect(result.entries.map((e) => e._id.toHexString())).toEqual([live._id.toHexString()]);
    expect(result.entries[0].accountDeleted).toBe(false);
  });

  it("deleted=true returns only deleted entries", () => {
    const liveUser = new ObjectId();
    const live = entry({ characterId: new ObjectId(), userId: liveUser });
    const orphan = entry({ userId: liveUser });
    const result = buildSuspiciousPage({
      entries: [live, orphan],
      existingCharIds: new Set([live.characterId.toHexString()]),
      existingUserIds: new Set([liveUser.toHexString()]),
      severity: undefined,
      deleted: true,
      showResolved: false,
      cursor: null,
      limit: 25,
    });
    expect(result.entries.map((e) => e._id.toHexString())).toEqual([orphan._id.toHexString()]);
    expect(result.entries[0].accountDeleted).toBe(true);
  });

  it("counts exclude deleted from high/medium/low and total them under deleted", () => {
    const liveUser = new ObjectId();
    const live = (sev: "low" | "medium" | "high") =>
      entry({ characterId: new ObjectId(), userId: liveUser, highestSeverity: sev });
    const liveHigh = live("high");
    const liveLow = live("low");
    const orphanMed = entry({ userId: liveUser, highestSeverity: "medium" });
    const result = buildSuspiciousPage({
      entries: [liveHigh, liveLow, orphanMed],
      existingCharIds: new Set([
        liveHigh.characterId.toHexString(),
        liveLow.characterId.toHexString(),
      ]),
      existingUserIds: new Set([liveUser.toHexString()]),
      severity: undefined,
      deleted: false,
      showResolved: false,
      cursor: null,
      limit: 25,
    });
    expect(result.counts).toEqual({
      high: 1,
      medium: 0,
      low: 1,
      deleted: 1,
      resolved: 0,
      automation: 0,
    });
  });

  it("orders by severity then flagCount and paginates by _id cursor", () => {
    const u = new ObjectId();
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const c3 = new ObjectId();
    const high = entry({ characterId: c1, userId: u, highestSeverity: "high", flagCount: 1 });
    const medA = entry({ characterId: c2, userId: u, highestSeverity: "medium", flagCount: 5 });
    const medB = entry({ characterId: c3, userId: u, highestSeverity: "medium", flagCount: 2 });
    const existingCharIds = new Set([c1.toHexString(), c2.toHexString(), c3.toHexString()]);
    const existingUserIds = new Set([u.toHexString()]);
    const page1 = buildSuspiciousPage({
      entries: [medB, high, medA],
      existingCharIds,
      existingUserIds,
      severity: undefined,
      deleted: false,
      showResolved: false,
      cursor: null,
      limit: 2,
    });
    expect(page1.entries.map((e) => e.highestSeverity)).toEqual(["high", "medium"]);
    expect(page1.entries[1].flagCount).toBe(5); // medA before medB
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBe(page1.entries[1]._id.toHexString());

    const page2 = buildSuspiciousPage({
      entries: [medB, high, medA],
      existingCharIds,
      existingUserIds,
      severity: undefined,
      deleted: false,
      showResolved: false,
      cursor: page1.nextCursor,
      limit: 2,
    });
    expect(page2.entries.map((e) => e._id.toHexString())).toEqual([medB._id.toHexString()]);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it("counts exclude dismissed entries even when they appear in the list", () => {
    const u = new ObjectId();
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const active = entry({ characterId: c1, userId: u, highestSeverity: "high" });
    const dismissed = entry({
      characterId: c2,
      userId: u,
      highestSeverity: "high",
      dismissed: true,
    });
    const result = buildSuspiciousPage({
      entries: [active, dismissed],
      existingCharIds: new Set([c1.toHexString(), c2.toHexString()]),
      existingUserIds: new Set([u.toHexString()]),
      severity: undefined,
      deleted: false,
      showResolved: false,
      cursor: null,
      limit: 25,
    });
    // Both shown (showDismissed path), but counts only reflect the active one.
    expect(result.entries).toHaveLength(2);
    expect(result.counts).toEqual({
      high: 1,
      medium: 0,
      low: 0,
      deleted: 0,
      resolved: 0,
      automation: 0,
    });
  });

  it("severity filter narrows the page but counts stay over the full set", () => {
    const u = new ObjectId();
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const high = entry({ characterId: c1, userId: u, highestSeverity: "high" });
    const low = entry({ characterId: c2, userId: u, highestSeverity: "low" });
    const result = buildSuspiciousPage({
      entries: [high, low],
      existingCharIds: new Set([c1.toHexString(), c2.toHexString()]),
      existingUserIds: new Set([u.toHexString()]),
      severity: "high",
      deleted: false,
      showResolved: false,
      cursor: null,
      limit: 25,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].highestSeverity).toBe("high");
    expect(result.counts).toEqual({
      high: 1,
      medium: 0,
      low: 1,
      deleted: 0,
      resolved: 0,
      automation: 0,
    });
  });

  it("resolved entries are counted separately and filtered by showResolved", () => {
    const u = new ObjectId();
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const active = entry({ characterId: c1, userId: u, highestSeverity: "high", pool: "active" });
    const resolved = entry({
      characterId: c2,
      userId: u,
      highestSeverity: "low",
      pool: "resolved",
      dismissed: true,
    });
    const existingCharIds = new Set([c1.toHexString(), c2.toHexString()]);
    const existingUserIds = new Set([u.toHexString()]);

    // Default: showResolved=false — only active entries
    const activePage = buildSuspiciousPage({
      entries: [active, resolved],
      existingCharIds,
      existingUserIds,
      severity: undefined,
      deleted: false,
      showResolved: false,
      cursor: null,
      limit: 25,
    });
    expect(activePage.entries).toHaveLength(1);
    expect(activePage.entries[0]._id.toHexString()).toBe(active._id.toHexString());
    expect(activePage.counts).toEqual({
      high: 1,
      medium: 0,
      low: 0,
      deleted: 0,
      resolved: 1,
      automation: 0,
    });

    // showResolved=true — only resolved entries
    const resolvedPage = buildSuspiciousPage({
      entries: [active, resolved],
      existingCharIds,
      existingUserIds,
      severity: undefined,
      deleted: false,
      showResolved: true,
      cursor: null,
      limit: 25,
    });
    expect(resolvedPage.entries).toHaveLength(1);
    expect(resolvedPage.entries[0]._id.toHexString()).toBe(resolved._id.toHexString());
    expect(resolvedPage.counts).toEqual({
      high: 1,
      medium: 0,
      low: 0,
      deleted: 0,
      resolved: 1,
      automation: 0,
    });
  });

  it("counts automation entries separately and the flagType filter narrows to them", () => {
    const u = new ObjectId();
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const autoFlag = {
      type: "automation_timing",
      severity: "high" as const,
      detail: "",
      detectedAt: new Date(),
      evidence: {},
    };
    const auto = entry({ characterId: c1, userId: u, highestSeverity: "high", flags: [autoFlag] });
    const other = entry({ characterId: c2, userId: u, highestSeverity: "medium" });
    const existingCharIds = new Set([c1.toHexString(), c2.toHexString()]);
    const existingUserIds = new Set([u.toHexString()]);

    const all = buildSuspiciousPage({
      entries: [auto, other],
      existingCharIds,
      existingUserIds,
      severity: undefined,
      deleted: false,
      showResolved: false,
      cursor: null,
      limit: 25,
    });
    expect(all.counts.automation).toBe(1);
    expect(all.counts.high).toBe(1);
    expect(all.counts.medium).toBe(1);

    const filtered = buildSuspiciousPage({
      entries: [auto, other],
      existingCharIds,
      existingUserIds,
      severity: undefined,
      deleted: false,
      showResolved: false,
      flagType: "automation_timing",
      cursor: null,
      limit: 25,
    });
    expect(filtered.entries).toHaveLength(1);
    expect(filtered.entries[0]._id.toHexString()).toBe(auto._id.toHexString());
    expect(filtered.counts.automation).toBe(1);
  });

  it("keeps deleted accounts hidden under the automation filter unless the deleted filter is on", () => {
    const u = new ObjectId();
    const liveChar = new ObjectId();
    const autoFlag = {
      type: "automation_timing",
      severity: "high" as const,
      detail: "",
      detectedAt: new Date(),
      evidence: {},
    };
    const liveAuto = entry({
      characterId: liveChar,
      userId: u,
      highestSeverity: "high",
      flags: [autoFlag],
    });
    // characterId not in the existing set → accountDeleted === true
    const deletedAuto = entry({ userId: u, highestSeverity: "high", flags: [autoFlag] });
    const existingCharIds = new Set([liveChar.toHexString()]);
    const existingUserIds = new Set([u.toHexString()]);

    const def = buildSuspiciousPage({
      entries: [liveAuto, deletedAuto],
      existingCharIds,
      existingUserIds,
      severity: undefined,
      deleted: false,
      showResolved: false,
      flagType: "automation_timing",
      cursor: null,
      limit: 25,
    });
    expect(def.entries.map((e) => e._id.toHexString())).toEqual([liveAuto._id.toHexString()]);

    const del = buildSuspiciousPage({
      entries: [liveAuto, deletedAuto],
      existingCharIds,
      existingUserIds,
      severity: undefined,
      deleted: true,
      showResolved: false,
      flagType: "automation_timing",
      cursor: null,
      limit: 25,
    });
    expect(del.entries.map((e) => e._id.toHexString())).toEqual([deletedAuto._id.toHexString()]);
  });
});
