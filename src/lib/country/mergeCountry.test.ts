import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/referendum/transfer/transferRegion", () => ({ transferRegion: vi.fn() }));
vi.mock("@/lib/turn/history/recordCountryEvent", () => ({ recordCountryEvent: vi.fn() }));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("1953-default"),
}));
vi.mock("@/lib/internationalOrganizations/joinApplication", () => ({ admitMember: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  isMember: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/internationalOrganizations/withdrawalBills", () => ({
  removeOrganizationMembership: vi.fn(),
}));

function prime(db: MockDb, name: string): MockCollection {
  return db.collection(name) as unknown as MockCollection;
}

function cursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("mergeCountry", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    prime(db, "countryGameStates").findOne.mockResolvedValue(null);
    prime(db, "countryGameStates").updateOne.mockResolvedValue({ matchedCount: 1 });
    prime(db, "states").find.mockReturnValue(cursor([{ _id: "BR" }, { _id: "SN" }, { _id: "TH" }]));
    const { transferRegion } = await import("@/lib/referendum/transfer/transferRegion");
    vi.mocked(transferRegion).mockResolvedValue({ ok: true });
  });

  it("refuses a country absorbing itself", async () => {
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DD",
      currentTurn: 412,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("cannot absorb itself");
  });

  it("is a no-op when the source is already dissolved", async () => {
    // The turn phase can see the same resolved crisis more than once.
    prime(db, "countryGameStates").findOne.mockResolvedValue({ _id: "DD", dissolvedTurn: 400 });
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(res).toMatchObject({ ok: true, regionsTransferred: 0, retired: true });
    const { transferRegion } = await import("@/lib/referendum/transfer/transferRegion");
    expect(vi.mocked(transferRegion)).not.toHaveBeenCalled();
  });

  it("refuses to merge into a country that is itself dissolved", async () => {
    prime(db, "countryGameStates").findOne.mockImplementation(async (f: { _id: string }) =>
      f._id === "DE" ? { _id: "DE", dissolvedTurn: 300 } : null
    );
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("itself been dissolved");
  });

  it("transfers every region of the absorbed country", async () => {
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(res.regionsTransferred).toBe(3);
    const { transferRegion } = await import("@/lib/referendum/transfer/transferRegion");
    expect(vi.mocked(transferRegion)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(transferRegion).mock.calls.map((c) => c[1].regionId)).toEqual([
      "BR",
      "SN",
      "TH",
    ]);
  });

  it("passes a null relocation target, because the source is dissolving", async () => {
    // The whole reason a merge is not a loop over the old transfer contract:
    // there is no rest-of-the-country for NPPs to retreat into.
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    const { transferRegion } = await import("@/lib/referendum/transfer/transferRegion");
    for (const call of vi.mocked(transferRegion).mock.calls) {
      expect(call[1].relocateToRegionId).toBeNull();
    }
  });

  it("retires the shell only after every region has moved", async () => {
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(res.retired).toBe(true);
    const [filter, update] = prime(db, "countryGameStates").updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "DD" });
    expect(update.$set).toMatchObject({ dissolvedTurn: 412, enabledForPlayers: false });
  });

  it("stops and does NOT retire when a region fails to transfer", async () => {
    // A merge that moved half a country and then retired it is worse than one
    // that stopped and can be re-run.
    const { transferRegion } = await import("@/lib/referendum/transfer/transferRegion");
    vi.mocked(transferRegion)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, skipped: "region-not-found" });
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(res.ok).toBe(false);
    expect(res.retired).toBe(false);
    expect(res.regionsTransferred).toBe(1);
    expect(prime(db, "countryGameStates").updateOne).not.toHaveBeenCalled();
  });

  it("counts an already-moved region as skipped, so a re-run completes", async () => {
    const { transferRegion } = await import("@/lib/referendum/transfer/transferRegion");
    vi.mocked(transferRegion).mockResolvedValue({ ok: true, skipped: "already-transferred" });
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(res).toMatchObject({
      ok: true,
      regionsTransferred: 0,
      regionsSkipped: 3,
      retired: true,
    });
  });

  it("transfers non-bloc memberships and leaves the bloc poles to the settlement", async () => {
    prime(db, "organizationMemberships").find.mockReturnValue(
      cursor([{ organizationId: "COMECON" }, { organizationId: "WARSAW_PACT" }])
    );
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });

    const { admitMember } = await import("@/lib/internationalOrganizations/joinApplication");
    const { removeOrganizationMembership } =
      await import("@/lib/internationalOrganizations/withdrawalBills");
    // COMECON: survivor admitted, dissolved country withdrawn via the live path.
    expect(vi.mocked(admitMember)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(admitMember).mock.calls[0].slice(1)).toEqual(["COMECON", "DE", 412]);
    expect(vi.mocked(removeOrganizationMembership)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(removeOrganizationMembership).mock.calls[0][1]).toBe("DD");
    expect(vi.mocked(removeOrganizationMembership).mock.calls[0][2]).toBe("COMECON");
    // The Warsaw Pact row is untouched here: which pole the unified state joins
    // is `adoptChallengerSettlement`'s carefully-ordered business.
  });

  it("does not re-admit a survivor already holding the seat", async () => {
    prime(db, "organizationMemberships").find.mockReturnValue(
      cursor([{ organizationId: "COMECON" }])
    );
    const { isMember } = await import("@/lib/internationalOrganizations/service");
    vi.mocked(isMember).mockResolvedValueOnce(true);
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    const { admitMember } = await import("@/lib/internationalOrganizations/joinApplication");
    const { removeOrganizationMembership } =
      await import("@/lib/internationalOrganizations/withdrawalBills");
    expect(vi.mocked(admitMember)).not.toHaveBeenCalled();
    expect(vi.mocked(removeOrganizationMembership)).toHaveBeenCalledTimes(1);
  });

  it("lapses pending bills, then hands the whole corpus to the survivor", async () => {
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    const calls = prime(db, "bills").updateMany.mock.calls;
    expect(calls).toHaveLength(2);
    // First: every non-terminal status fails (the country dissolved under it).
    expect(calls[0][0].countryId).toBe("DD");
    expect(calls[0][0].status.$in).toContain("proposed");
    expect(calls[0][0].status.$in).toContain("cabinet_review");
    expect(calls[0][0].status.$in).not.toContain("signed");
    expect(calls[0][1].$set.status).toBe("failed");
    // Then: the corpus re-scopes, so the trade reconcilers rebuild the carried
    // tariffs/embargoes under the survivor instead of resurrecting the ghost's.
    expect(calls[1][0]).toEqual({ countryId: "DD" });
    expect(calls[1][1].$set.countryId).toBe("DE");
  });

  it("carries national-pool npps and tariff records by countryId", async () => {
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(prime(db, "npps").updateMany.mock.calls[0][0]).toEqual({ countryId: "DD" });
    expect(prime(db, "npps").updateMany.mock.calls[0][1].$set.countryId).toBe("DE");
    expect(prime(db, "tariffs").updateMany.mock.calls[0][0]).toEqual({ countryId: "DD" });
    expect(prime(db, "tariffs").updateMany.mock.calls[0][1].$set.countryId).toBe("DE");
    // National-scope subsidies (region-scoped ones crossed with their regions).
    expect(prime(db, "subsidies").updateMany.mock.calls[0][0]).toEqual({ countryId: "DD" });
    expect(prime(db, "subsidies").updateMany.mock.calls[0][1].$set.countryId).toBe("DE");
  });

  it("the winner's tariff takes a colliding scope from the survivor", async () => {
    // Both states tariffed the same sector: two live records on one scope
    // would double-apply, and the merge rule is that the winner's law governs.
    prime(db, "tariffs").find.mockReturnValue(
      cursor([{ _id: "t-dd", scopeType: "sector", targetSectorType: "manufacturing" }])
    );
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    const del = prime(db, "tariffs").deleteMany.mock.calls[0][0];
    expect(del).toEqual({
      countryId: "DE",
      $or: [
        {
          scopeType: "sector",
          targetSectorType: "manufacturing",
          targetOriginCountryId: null,
          targetCorporationId: null,
        },
      ],
    });
  });

  it("records the absorption against the surviving country", async () => {
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    const { recordCountryEvent } = await import("@/lib/turn/history/recordCountryEvent");
    const event = vi.mocked(recordCountryEvent).mock.calls[0][1];
    expect(event.countryId).toBe("DE");
    expect(event.eventType).toBe("region_transferred");
    expect(event.title).toContain("absorbed into");
  });
  it("purges the dissolving country's intelligence, as owner AND as target", async () => {
    // A dissolved country leaves the registry entirely, so rows naming it would
    // be invisible to every surface while the turn phase still read them.
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });

    expect(prime(db, "intelligenceAgencies").deleteMany).toHaveBeenCalledWith({
      countryId: "DD",
    });
    for (const collection of ["intelligenceNetworks", "intelligenceCoverage"]) {
      expect(prime(db, collection).deleteMany).toHaveBeenCalledWith({
        $or: [{ ownerCountryId: "DD" }, { targetCountryId: "DD" }],
      });
    }
  });

  it("does NOT hand the survivor the dissolved country's networks", async () => {
    // A network is access built by a service that no longer exists. Inheriting
    // one would make dissolving a state a cheap way to buy reach.
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(prime(db, "intelligenceNetworks").updateMany).not.toHaveBeenCalled();
  });

  it("leaves the operation log alone, because the incidents did happen", async () => {
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(prime(db, "intelligenceOpLog").deleteMany).not.toHaveBeenCalled();
  });
});
