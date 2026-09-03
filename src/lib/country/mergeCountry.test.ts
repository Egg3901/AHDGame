import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockCollection, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/referendum/transfer/transferRegion", () => ({ transferRegion: vi.fn() }));
// Both return promises: `mergeCountry` chains `.catch()` onto them, because a
// failure in a country-wide recompute must not fail a merge that has completed.
vi.mock("@/lib/nationalMetrics", () => ({
  computeNationalMetrics: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/referendum/transfer/reseedJoinedRegionElections", () => ({
  reseedJoinedRegionElections: vi.fn().mockResolvedValue(undefined),
}));
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
// Pinned rather than left to the ambient forex flag: whether a National
// Corporation re-denominates on a merge is the behaviour under test, not a
// side effect of how the suite happens to be configured.
vi.mock("@/lib/country/mergeFxScale", () => ({
  loadFxScalePair: vi.fn().mockResolvedValue({ kind: "no-conversion" }),
}));
vi.mock("@/lib/corporations/convertCorpCurrency", () => ({
  convertCorpCurrency: vi.fn().mockResolvedValue({ ok: true, converted: true }),
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
    // `clearAllMocks` clears CALLS but keeps implementations, so a test that
    // stubs a "convert" pair would otherwise leak it into every test after it.
    const { loadFxScalePair } = await import("@/lib/country/mergeFxScale");
    vi.mocked(loadFxScalePair).mockResolvedValue({ kind: "no-conversion" });
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

  it("runs the country-wide passes ONCE, not once per region", async () => {
    // `computeNationalMetrics` recomputes every country in the world and
    // `reseedJoinedRegionElections` re-seeds a whole country's races. Neither is
    // scoped to the region that moved, so doing them per region cost a live
    // reunification about five seconds a Land, blew the request timeout it was
    // started from, and left the country half-merged.
    const { mergeCountry } = await import("./mergeCountry");
    const { computeNationalMetrics } = await import("@/lib/nationalMetrics");
    const { reseedJoinedRegionElections } =
      await import("@/lib/referendum/transfer/reseedJoinedRegionElections");
    const { transferRegion } = await import("@/lib/referendum/transfer/transferRegion");

    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 470,
    });

    expect(vi.mocked(transferRegion).mock.calls.length).toBeGreaterThan(1);
    // Every transfer defers them...
    for (const call of vi.mocked(transferRegion).mock.calls) {
      expect(call[1].deferCountryWidePasses).toBe(true);
    }
    // ...and the merge pays for them exactly once, after the whole border moved.
    expect(vi.mocked(computeNationalMetrics)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reseedJoinedRegionElections)).toHaveBeenCalledTimes(1);
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

  it("leaves ONE primary National Corporation, folding the absorbed shell in", async () => {
    // Ticket #1254. Every resolver reads the primary with a single-document
    // query, so a second flagged corporation is picked by natural order and
    // silently takes every merge-back, nationalisation and bond tranche.
    const corps = prime(db, "corporations");
    corps.findOne.mockResolvedValue({
      _id: "survivor",
      name: "East Germany",
      liquidCapital: 100,
      liquidCurrencyCode: "DDM",
    });
    corps.find.mockReturnValue(
      cursor([{ _id: "shell", name: "Germany", liquidCapital: 40, liquidCurrencyCode: "DDM" }])
    );

    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });

    // The absorbed state's corporations become the survivor's.
    expect(corps.updateMany).toHaveBeenCalledWith(
      { countryOwnerId: "DE" },
      expect.objectContaining({ $set: expect.objectContaining({ countryOwnerId: "DD" }) })
    );
    // Sectors and bonds follow the shell onto the survivor...
    expect(prime(db, "corporateSectors").updateMany).toHaveBeenCalledWith(
      { corporationId: "shell" },
      expect.objectContaining({ $set: expect.objectContaining({ corporationId: "survivor" }) })
    );
    expect(prime(db, "bonds").updateMany).toHaveBeenCalledWith(
      { corporationId: "shell" },
      expect.objectContaining({ $set: expect.objectContaining({ corporationId: "survivor" }) })
    );
    // ...its cash moves at matching currency, and the empty shell is dissolved.
    expect(corps.updateOne).toHaveBeenCalledWith(
      { _id: "survivor" },
      expect.objectContaining({ $inc: { liquidCapital: 40 } })
    );
    expect(corps.deleteOne).toHaveBeenCalledWith({ _id: "shell" });
  });

  it("keeps a shell whose cash is in another currency, but demotes it", async () => {
    // Redenomination is the regime/FX merge's job. Adding across denominations
    // would mis-state the unified treasury, so the balance stays visible on a
    // named corporation rather than being silently absorbed or deleted.
    const corps = prime(db, "corporations");
    corps.findOne.mockResolvedValue({
      _id: "survivor",
      name: "East Germany",
      liquidCapital: 100,
      liquidCurrencyCode: "DDM",
    });
    corps.find.mockReturnValue(
      cursor([{ _id: "shell", name: "Germany", liquidCapital: 40, liquidCurrencyCode: "EUR" }])
    );

    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });

    expect(corps.deleteOne).not.toHaveBeenCalledWith({ _id: "shell" });
    expect(corps.updateOne).toHaveBeenCalledWith(
      { _id: "shell" },
      expect.objectContaining({
        $set: expect.objectContaining({ isPrimaryNationalCorporation: false }),
      })
    );
  });

  it("keeps the absorbed primary when the survivor has none of its own", async () => {
    // Demoting it would leave the unified country with no primary at all.
    const corps = prime(db, "corporations");
    corps.findOne.mockResolvedValue(null);
    corps.find.mockReturnValue(cursor([{ _id: "shell", name: "Germany", liquidCapital: 0 }]));

    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });

    expect(corps.deleteOne).not.toHaveBeenCalledWith({ _id: "shell" });
  });

  it("folds the REST in when the survivor has no primary of its own", async () => {
    // Returning early on a missing incumbent would leave both absorbed primaries
    // flagged -- the same two-primary state, on a country that had neither.
    const corps = prime(db, "corporations");
    // No incumbent, but the promoted survivor still has to read back.
    corps.findOne.mockImplementation(async (filter: Record<string, unknown>) =>
      filter && "_id" in filter ? { _id: filter._id, name: "Germany", liquidCapital: 0 } : null
    );
    corps.find.mockReturnValue(
      cursor([
        { _id: "first", name: "Germany", liquidCapital: 0 },
        { _id: "second", name: "Germany (Bonn)", liquidCapital: 0 },
      ])
    );

    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });

    // The first becomes the survivor; only the second is dissolved.
    expect(corps.deleteOne).toHaveBeenCalledWith({ _id: "second" });
    expect(corps.deleteOne).not.toHaveBeenCalledWith({ _id: "first" });
  });

  it("redomiciles corporations left in the dissolved country", async () => {
    // A National Corporation is built with `headquartersState: ""`, so the region
    // sweep -- which moves corporations by HQ region -- can never reach one.
    const corps = prime(db, "corporations");
    corps.findOne.mockResolvedValue({ _id: "survivor", name: "East Germany" });
    corps.find.mockReturnValue(cursor([]));

    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });

    expect(corps.updateMany).toHaveBeenCalledWith(
      { countryId: "DE" },
      expect.objectContaining({ $set: expect.objectContaining({ countryId: "DD" }) })
    );
    // Ownership and domicile are separate filters: a firm the dissolved state
    // nationalised abroad keeps its own domicile.
    expect(corps.updateMany).not.toHaveBeenCalledWith(
      { countryOwnerId: "DE" },
      expect.objectContaining({ $set: expect.objectContaining({ countryId: "DD" }) })
    );
  });

  it("merges the shell's shareholdings into the survivor's, share-weighted", async () => {
    // A holding lives on the ISSUER, keyed by the holder's corporationId, so
    // deleting the shell would leave those shares belonging to nobody.
    const corps = prime(db, "corporations");
    corps.findOne.mockResolvedValue({
      _id: "survivor",
      name: "East Germany",
      liquidCapital: 0,
    });
    corps.find.mockImplementation((filter: Record<string, unknown>) => {
      if (filter && "shareholders.corporationId" in filter) {
        return cursor([
          {
            _id: "issuer",
            shareholders: [
              { corporationId: "shell", shares: 100, avgCostPerShare: 10 },
              { corporationId: "survivor", shares: 100, avgCostPerShare: 20 },
              { characterId: "player", shares: 5 },
            ],
          },
        ]);
      }
      return cursor([{ _id: "shell", name: "Germany", liquidCapital: 0 }]);
    });

    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });

    const call = corps.updateOne.mock.calls.find(
      (c: unknown[]) => (c[0] as { _id?: string })?._id === "issuer"
    );
    expect(call).toBeDefined();
    const written = (call![1] as { $set: { shareholders: Array<Record<string, unknown>> } }).$set
      .shareholders;
    // One merged holder entry, and the player's untouched.
    expect(written).toEqual([
      { characterId: "player", shares: 5 },
      { corporationId: "survivor", shares: 200, avgCostPerShare: 15 },
    ]);
  });

  it("re-denominates the corporations the region sweep cannot reach", async () => {
    // `convertTransferredResidentsCurrency` keys on `headquartersState`, and a
    // National Corporation is built with "". Left undone, the unified state's own
    // enterprises keep quoting the dissolved country's currency.
    const { loadFxScalePair } = await import("@/lib/country/mergeFxScale");
    const { convertCorpCurrency } = await import("@/lib/corporations/convertCorpCurrency");
    vi.mocked(loadFxScalePair).mockResolvedValue({
      kind: "convert",
      scale: 2,
      oldCurrency: "EUR",
      newCurrency: "DDM",
      fxByCurrency: new Map(),
    } as never);

    const corps = prime(db, "corporations");
    corps.findOne.mockResolvedValue({ _id: "survivor", name: "East Germany" });
    corps.find.mockReturnValue(cursor([{ _id: "natcorp", headquartersState: "" }]));

    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });

    // Captured by the no-HQ filter, and converted through the SHARED helper so it
    // crosses at the same rate as every other pot of money in the merge.
    const strandedQuery = corps.find.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>)?.countryId === "DE"
    );
    expect(strandedQuery).toBeDefined();
    expect(vi.mocked(convertCorpCurrency)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: "natcorp" }),
      "DDM",
      expect.anything(),
      expect.any(Date),
      true
    );
  });

  it("leaves a balance alone when the merge rate is missing", async () => {
    // Converting at 1 would persist an order-of-magnitude wrong balance. A
    // corporation survives the merge, so a later pass can still re-denominate it.
    const { loadFxScalePair } = await import("@/lib/country/mergeFxScale");
    const { convertCorpCurrency } = await import("@/lib/corporations/convertCorpCurrency");
    vi.mocked(loadFxScalePair).mockResolvedValue({ kind: "missing-rate" } as never);

    const corps = prime(db, "corporations");
    corps.findOne.mockResolvedValue({ _id: "survivor", name: "East Germany" });
    corps.find.mockReturnValue(cursor([{ _id: "natcorp", headquartersState: "" }]));

    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });

    expect(vi.mocked(convertCorpCurrency)).not.toHaveBeenCalled();
  });

  it("demotes rather than dissolves a shell that has its own shareholders", async () => {
    // Deleting it would take their shares with it.
    const corps = prime(db, "corporations");
    corps.findOne.mockResolvedValue({ _id: "survivor", name: "East Germany" });
    corps.find.mockReturnValue(
      cursor([
        {
          _id: "shell",
          name: "Germany",
          liquidCapital: 0,
          shareholders: [{ characterId: "player", shares: 10 }],
        },
      ])
    );

    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });

    expect(corps.deleteOne).not.toHaveBeenCalledWith({ _id: "shell" });
    expect(corps.updateOne).toHaveBeenCalledWith(
      { _id: "shell" },
      expect.objectContaining({
        $set: expect.objectContaining({ isPrimaryNationalCorporation: false }),
      })
    );
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

  it("leaves the SURVIVOR's tariff standing when the survivor is the winner", async () => {
    // The same collision, decided the other way. A tariff is legislated policy,
    // so it follows the side that WON -- and when the victor is the surviving
    // shell, deleting its record would keep the defeated state's trade policy.
    //
    // The two sides carry DIFFERENT scopes on purpose: the delete must be built
    // from the WINNER's list and land on the loser. Reading the scopes from the
    // absorbed side and only flipping the target country would match each of its
    // records against its own scope and delete the lot.
    prime(db, "tariffs").find.mockImplementation((f: { countryId: string }) =>
      cursor(
        f.countryId === "DD"
          ? [{ _id: "t-dd", scopeType: "sector", targetSectorType: "chemicals" }]
          : [{ _id: "t-de", scopeType: "sector", targetSectorType: "manufacturing" }]
      )
    );
    const { mergeCountry } = await import("./mergeCountry");
    await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
      absorbedTariffsWin: false,
    });
    const del = prime(db, "tariffs").deleteMany.mock.calls[0][0];
    expect(del).toEqual({
      // The ABSORBED side's record is the one that yields ...
      countryId: "DE",
      // ... and only where it meets a scope the SURVIVOR actually legislated.
      $or: [
        {
          scopeType: "sector",
          targetSectorType: "chemicals",
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

  it("cancels the absorbed country's live races still keyed to it", async () => {
    // A race the region sweep missed (or that the re-key never matched) would
    // keep campaigning for a country the merge is dissolving.
    const electionId = { _id: "e-stray" };
    prime(db, "elections").find.mockImplementation((f: { countryId?: string }) =>
      cursor(f.countryId === "DD" ? [electionId] : [])
    );
    prime(db, "elections").deleteMany.mockResolvedValue({ deletedCount: 1 });
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(res.electionsCancelled).toBe(1);
    expect(prime(db, "electionCandidates").deleteMany).toHaveBeenCalledWith({
      electionId: { $in: [electionId._id] },
    });
    expect(prime(db, "elections").deleteMany).toHaveBeenCalledWith({
      _id: { $in: [electionId._id] },
    });
  });

  it("cancels survivor-keyed races of the absorbed constitution, leaves its own alone", async () => {
    // The live #1252 shape: rescopeRegionToCountry re-keyed the absorbed side's
    // active races onto the survivor, so they no longer carry the dissolved
    // countryId and the per-region sweep never saw them. The GDR survives here,
    // so DE-family races (bundestag, landtag) on DD are the ghosts; the
    // Volkskammer race is DD's own calendar and must survive the merge.
    const ghostBundestag = { _id: "e-bt", electionType: "bundestag" };
    const ghostLandtag = { _id: "e-lt", electionType: "landtag" };
    const ownVolkskammer = { _id: "e-vk", electionType: "volkskammerDeputy" };
    prime(db, "elections").find.mockImplementation((f: { countryId?: string }) =>
      cursor(f.countryId === "DD" ? [ownVolkskammer, ghostBundestag, ghostLandtag] : [])
    );
    prime(db, "elections").deleteMany.mockResolvedValue({ deletedCount: 2 });
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });
    expect(res.electionsCancelled).toBe(2);
    const del = prime(db, "elections").deleteMany.mock.calls[0][0];
    expect(del._id.$in).toEqual(expect.arrayContaining([ghostBundestag._id, ghostLandtag._id]));
    expect(del._id.$in).not.toContain(ownVolkskammer._id);
  });

  it("leaves survivor races of a type the remap table does not name", async () => {
    // The filter is scoped to the pair's declared mapping: a live race of some
    // third constitution's type is not this merge's business.
    prime(db, "elections").find.mockImplementation((f: { countryId?: string }) =>
      cursor(f.countryId === "DD" ? [{ _id: "e-vk", electionType: "volkskammerDeputy" }] : [])
    );
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DE",
      toCountryId: "DD",
      currentTurn: 412,
    });
    expect(res.electionsCancelled).toBe(0);
    expect(prime(db, "elections").deleteMany).not.toHaveBeenCalled();
  });

  it("cancels nothing when there is nothing live to cancel", async () => {
    prime(db, "elections").find.mockReturnValue(cursor([]));
    const { mergeCountry } = await import("./mergeCountry");
    const res = await mergeCountry(db as unknown as Db, {
      fromCountryId: "DD",
      toCountryId: "DE",
      currentTurn: 412,
    });
    expect(res.electionsCancelled).toBe(0);
    expect(prime(db, "elections").deleteMany).not.toHaveBeenCalled();
  });
});
