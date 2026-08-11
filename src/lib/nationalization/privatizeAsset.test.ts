import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
}));
// Market-share is canonically tested in marketShare.test.ts; stub it so the
// carve-cap branch is driven directly (share % → max carve fraction).
vi.mock("@/lib/corporations/marketShare", () => ({
  fetchSectorMarketSharePercent: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/currency/govBudgetFields", () => ({
  writeGovBudgetLocal: vi.fn((v: number) => v),
}));
vi.mock("@/lib/centralBank/helpers", () => ({ getBankId: vi.fn(() => "US") }));
// NPV math is canonically tested elsewhere; fix a deterministic valuation so the
// orchestration (cap table, carve, treasury credit) is what we assert.
vi.mock("@/lib/bonds/corporateBondDefault", () => ({
  buildPrimeRateMap: vi.fn(() => new Map()),
  computeSectorNpvSum: vi.fn(() => 5_000_000),
}));
vi.mock("@/lib/db/sequentialId", () => ({
  getNextSequentialId: vi.fn().mockResolvedValue(4242),
}));
// Caretaker-CEO selection queries parties/corps/npps; stub it so the IPO path
// gets a deterministic NPP CEO without a full NPP fixture.
vi.mock("@/lib/corporations/subsidiaries/nppCeoSelection", () => ({
  pickOrCreateNppCeoForNewCorp: vi.fn().mockResolvedValue(new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa")),
}));
vi.mock("./consequences/apply", () => ({
  applyPrivatizationConsequences: vi
    .fn()
    .mockResolvedValue({ confidenceBefore: 70, confidenceAfter: 74, legitimacyDelta: 1 }),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineCorpPrivatized: vi.fn().mockReturnValue("headline"),
}));
vi.mock("./privatizationNotifications", () => ({
  notifyCountryResidents: vi.fn().mockResolvedValue(undefined),
}));
// ensurePrimaryNationalCorporation is tested in nationalCorporation.test.ts.
vi.mock("./nationalCorporation", async (orig) => ({
  ...(await orig<typeof import("./nationalCorporation")>()),
  ensurePrimaryNationalCorporation: vi.fn(),
}));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("privatizeAsset", () => {
  let db: MockDb;
  const natCorpId = new ObjectId();
  const sectorId = new ObjectId();

  const source = {
    _id: natCorpId,
    name: "United States National Corporation",
    countryId: "US",
    countryOwnerId: "US",
    ownershipState: "stateOwned",
    isPrimaryNationalCorporation: true,
    liquidCurrencyCode: "USD",
  };
  const baseSector = {
    _id: sectorId,
    corporationId: natCorpId,
    countryId: "US",
    stateId: "CA",
    sectorType: "energy",
    revenue: 1_000_000,
    profitMargin: 30,
    workers: 500,
    targetGrowthRate: 1,
    currentGrowthRate: 1,
    currentGrowthCost: 1000,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["corporations", "corporateSectors", "centralBanks", "federalBudget"])
      db.collection(n);
    db.collectionMocks.corporations.findOne.mockImplementation(
      async (q: Record<string, unknown>) => {
        if (q._id && (q._id as ObjectId).equals?.(natCorpId)) return source;
        if (q.name) return null; // no name collision
        return null;
      }
    );
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({ ...baseSector });
    db.collectionMocks.centralBanks.find.mockReturnValue(cursor([]));
    db.collectionMocks.corporations.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    const { ensurePrimaryNationalCorporation } = await import("./nationalCorporation");
    vi.mocked(ensurePrimaryNationalCorporation).mockResolvedValue(source as never);
    const { fetchSectorMarketSharePercent } = await import("@/lib/corporations/marketShare");
    vi.mocked(fetchSectorMarketSharePercent).mockResolvedValue(0); // tiny share ⇒ full carve allowed
  });

  it("creates a private spun-out corp, carves a sector slice, credits the treasury", async () => {
    const { privatizeAsset } = await import("./privatizeAsset");
    const res = await privatizeAsset(db as unknown as Db, {
      countryId: "US",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId, carveFraction: 0.3 }],
      newCorpName: "Pacific Power Co",
      goldenSharePercent: 0.2,
      method: "ipo",
      turn: 10,
    });

    const doc = db.collectionMocks.corporations.insertOne.mock.calls[0][0];
    expect(doc.ownershipState).toBe("private");
    expect(doc.countryOwnerId).toBeUndefined();
    expect(doc.isPrivate).toBe(false);
    expect(doc.legalStructure).toBe("us_c_corp");
    // IPO spin-out gets an NPP caretaker CEO (not vacant) so it is NOT bled
    // 10%/turn back to the nat corp by the vacant-CEO sector shed (#2926).
    expect(doc.ceoVacant).toBe(false);
    expect(doc.ceoType).toBe("npp");
    expect(doc.liquidCapital).toBe(0);
    expect(doc.privatizedAtTurn).toBe(10);
    expect(doc.publicFloat).toBe(doc.totalShares - res.goldenShares);
    expect(doc.shareholders).toEqual([{ corporationId: natCorpId, shares: res.goldenShares }]);

    // Anti-monopoly cap ⇒ always a partial clone: a 30% slice on the new corp,
    // source row shrunk to 70% and keeping its cooldown anchor.
    const ins = db.collectionMocks.corporateSectors.insertOne.mock.calls[0][0];
    expect(ins.corporationId).toEqual(res.newCorporationId);
    expect(ins.revenue).toBe(300_000);
    expect(ins.absorbedAtTurn).toBeUndefined();
    const upd = db.collectionMocks.corporateSectors.updateOne.mock.calls[0];
    expect(upd[1].$set.revenue).toBe(700_000);

    // Treasury credited the float proceeds once.
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalledTimes(1);
    expect(res.proceedsLocal).toBeGreaterThan(0);
    expect(res.sectorsCarved).toBe(1);

    // IPO completes immediately → privatization consequences + completion wire fire.
    const { applyPrivatizationConsequences } = await import("./consequences/apply");
    expect(vi.mocked(applyPrivatizationConsequences)).toHaveBeenCalledWith(db, {
      countryId: "US",
      turn: 10,
    });
    const { logWireEvent } = await import("@/lib/wireEvent");
    expect(vi.mocked(logWireEvent)).toHaveBeenCalledWith(
      "corporation_privatized",
      expect.anything(),
      expect.anything()
    );

    // IPO records a privatization row on the public State Ownership Register.
    const led = db.collectionMocks.nationalizationLedger.insertOne.mock.calls[0][0];
    expect(led.kind).toBe("privatize_ipo");
    expect(led.countryId).toBe("US");
    expect(led.nationalCorporationId).toEqual(natCorpId);
    expect(led.newCorpName).toBe("Pacific Power Co");
    expect(led.sectorTypes).toContain("energy");
    expect(led.method).toBeUndefined(); // authority path not threaded through the engine
    expect(led.tier).toBeUndefined(); // no compensation on a privatization
    expect(led.confidenceAfter).toBe(74);
    expect(led.turn).toBe(10);

    // IPO open broadcasts an offering notification to the country's residents.
    const { notifyCountryResidents } = await import("./privatizationNotifications");
    expect(vi.mocked(notifyCountryResidents)).toHaveBeenCalledWith(
      db,
      "US",
      expect.objectContaining({ type: "corp_privatization_offered" })
    );
  });

  it("defaults the IPO headquarters to the first carved sector's region", async () => {
    const { privatizeAsset } = await import("./privatizeAsset");
    await privatizeAsset(db as unknown as Db, {
      countryId: "US",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId, carveFraction: 0.3 }],
      newCorpName: "Default HQ Co",
      goldenSharePercent: 0,
      method: "ipo",
      turn: 10,
    });
    const doc = db.collectionMocks.corporations.insertOne.mock.calls[0][0];
    expect(doc.headquartersState).toBe("CA"); // baseSector.stateId
  });

  it("sets a chosen, in-country IPO headquarters region", async () => {
    db.collection("states");
    db.collectionMocks.states.findOne.mockResolvedValue({
      _id: "TX",
      countryId: "US",
      name: "Texas",
    });
    const { privatizeAsset } = await import("./privatizeAsset");
    await privatizeAsset(db as unknown as Db, {
      countryId: "US",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId, carveFraction: 0.3 }],
      newCorpName: "Texas HQ Co",
      goldenSharePercent: 0,
      method: "ipo",
      headquartersState: "TX",
      turn: 10,
    });
    const doc = db.collectionMocks.corporations.insertOne.mock.calls[0][0];
    expect(doc.headquartersState).toBe("TX");
    expect(db.collectionMocks.states.findOne).toHaveBeenCalledWith({ _id: "TX", countryId: "US" });
  });

  it("rejects an IPO headquarters region that is not in the country", async () => {
    db.collection("states");
    db.collectionMocks.states.findOne.mockResolvedValue(null); // region not found for this country
    const { privatizeAsset } = await import("./privatizeAsset");
    await expect(
      privatizeAsset(db as unknown as Db, {
        countryId: "US",
        sourceNationalCorporationId: natCorpId,
        selections: [{ sectorId, carveFraction: 0.3 }],
        newCorpName: "Bad HQ Co",
        goldenSharePercent: 0,
        method: "ipo",
        headquartersState: "ZZ",
        turn: 10,
      })
    ).rejects.toThrow(/headquarters region/i);
  });

  it("auction method creates a suspended, 100%-state-held shell and opens an auction", async () => {
    db.collection("nationalizationAuctions");
    db.collectionMocks.nationalizationAuctions.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });
    const { privatizeAsset } = await import("./privatizeAsset");
    const res = await privatizeAsset(db as unknown as Db, {
      countryId: "US",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId, carveFraction: 0.3 }],
      newCorpName: "Auctioned Co",
      goldenSharePercent: 0.1,
      method: "auction",
      reservePrice: 1_000_000,
      turn: 20,
    });

    const doc = db.collectionMocks.corporations.insertOne.mock.calls[0][0];
    expect(doc.suspended).toBe(true);
    expect(doc.isPrivate).toBe(true);
    expect(doc.legalStructure).toBe("us_c_corp");
    expect(doc.hiddenFromExchange).toBe(true);
    expect(doc.publicFloat).toBe(0);
    expect(doc.privatizedAtTurn).toBeUndefined(); // set at sale, not at open
    expect(doc.shareholders).toEqual([{ corporationId: natCorpId, shares: doc.totalShares }]);

    // No upfront treasury credit for the auction method.
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
    expect(res.proceedsLocal).toBe(0);

    // Auction opened with the right window + reserve.
    const auction = db.collectionMocks.nationalizationAuctions.insertOne.mock.calls[0][0];
    expect(auction.status).toBe("open");
    expect(auction.closesAtTurn).toBe(20 + 48);
    expect(auction.reservePrice).toBe(1_000_000);
    expect(res.auctionId).toBeDefined();

    // Auction open is NOT a completed privatization → no consequences, no wire yet.
    const { applyPrivatizationConsequences } = await import("./consequences/apply");
    expect(vi.mocked(applyPrivatizationConsequences)).not.toHaveBeenCalled();
    const { logWireEvent } = await import("@/lib/wireEvent");
    expect(vi.mocked(logWireEvent)).not.toHaveBeenCalled();

    // ...but residents are still pinged to come bid (offering broadcast on open).
    const { notifyCountryResidents } = await import("./privatizationNotifications");
    expect(vi.mocked(notifyCountryResidents)).toHaveBeenCalledWith(
      db,
      "US",
      expect.objectContaining({ type: "corp_privatization_offered" })
    );
    // No ledger row at auction open — that lands at sale in the resolver.
    expect(db.collectionMocks.nationalizationLedger?.insertOne).toBeUndefined();
  });

  it("rejects a carve that would push the new corp past the market-control cap", async () => {
    // Holding IS the whole regional market (≈100% share) ⇒ max carve is 30%, so
    // a 50% carve is rejected.
    const { fetchSectorMarketSharePercent } = await import("@/lib/corporations/marketShare");
    vi.mocked(fetchSectorMarketSharePercent).mockResolvedValue(100);
    const { privatizeAsset } = await import("./privatizeAsset");
    await expect(
      privatizeAsset(db as unknown as Db, {
        countryId: "US",
        sourceNationalCorporationId: natCorpId,
        selections: [{ sectorId, carveFraction: 0.5 }],
        newCorpName: "Too Big Co",
        goldenSharePercent: 0,
        method: "ipo",
        turn: 1,
      })
    ).rejects.toThrow(/market/i);
  });

  it("allows a full carve when the holding is a small share of the market", async () => {
    // ~1% market share ⇒ max carve is 100%, so a full spin-out is allowed.
    const { fetchSectorMarketSharePercent } = await import("@/lib/corporations/marketShare");
    vi.mocked(fetchSectorMarketSharePercent).mockResolvedValue(1);
    const { privatizeAsset } = await import("./privatizeAsset");
    const res = await privatizeAsset(db as unknown as Db, {
      countryId: "US",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId, carveFraction: 1 }],
      newCorpName: "Full Spinout Co",
      goldenSharePercent: 0,
      method: "ipo",
      turn: 1,
    });
    expect(res.sectorsCarved).toBe(1);
    // Fully divested ⇒ the emptied source row is deleted, not shrunk to 0.
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({ _id: sectorId });
  });

  it("partial carve clones a fractional sector and reduces the source row", async () => {
    const { privatizeAsset } = await import("./privatizeAsset");
    await privatizeAsset(db as unknown as Db, {
      countryId: "US",
      sourceNationalCorporationId: natCorpId,
      selections: [{ sectorId, carveFraction: 0.25 }],
      newCorpName: "Quarter Energy Co",
      goldenSharePercent: 0,
      method: "ipo",
      turn: 5,
    });

    const ins = db.collectionMocks.corporateSectors.insertOne.mock.calls[0][0];
    expect(ins.revenue).toBe(250_000);
    expect(ins.workers).toBe(125);
    expect(ins.corporationId).toBeDefined();
    const upd = db.collectionMocks.corporateSectors.updateOne.mock.calls[0];
    expect(upd[1].$set.revenue).toBe(750_000);
    expect(upd[1].$set.workers).toBe(375);
  });

  it("rejects a name collision", async () => {
    db.collectionMocks.corporations.findOne.mockImplementation(
      async (q: Record<string, unknown>) => {
        if (q.name) return { _id: new ObjectId(), name: "Taken" };
        return source;
      }
    );
    const { privatizeAsset } = await import("./privatizeAsset");
    await expect(
      privatizeAsset(db as unknown as Db, {
        countryId: "US",
        sourceNationalCorporationId: natCorpId,
        selections: [{ sectorId, carveFraction: 0.3 }],
        newCorpName: "Taken",
        goldenSharePercent: 0,
        method: "ipo",
        turn: 1,
      })
    ).rejects.toThrow(/name/i);
    expect(db.collectionMocks.corporations.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a sector still inside the re-privatization cooldown", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      ...baseSector,
      absorbedAtTurn: 100,
    });
    const { privatizeAsset } = await import("./privatizeAsset");
    await expect(
      privatizeAsset(db as unknown as Db, {
        countryId: "US",
        sourceNationalCorporationId: natCorpId,
        selections: [{ sectorId, carveFraction: 0.3 }],
        newCorpName: "Too Soon Co",
        goldenSharePercent: 0,
        method: "ipo",
        turn: 110, // 110 - 100 = 10 < REPRIVATIZE_COOLDOWN_TURNS
      })
    ).rejects.toThrow(/cooldown/i);
  });

  it("rejects a sector not owned by the source National Corporation", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      ...baseSector,
      corporationId: new ObjectId(),
    });
    const { privatizeAsset } = await import("./privatizeAsset");
    await expect(
      privatizeAsset(db as unknown as Db, {
        countryId: "US",
        sourceNationalCorporationId: natCorpId,
        selections: [{ sectorId, carveFraction: 0.3 }],
        newCorpName: "Not Yours Co",
        goldenSharePercent: 0,
        method: "ipo",
        turn: 1,
      })
    ).rejects.toThrow(/sector/i);
  });

  it("rejects a carve fraction below the minimum", async () => {
    const { privatizeAsset } = await import("./privatizeAsset");
    await expect(
      privatizeAsset(db as unknown as Db, {
        countryId: "US",
        sourceNationalCorporationId: natCorpId,
        selections: [{ sectorId, carveFraction: 0.01 }],
        newCorpName: "Tiny Carve Co",
        goldenSharePercent: 0,
        method: "ipo",
        turn: 1,
      })
    ).rejects.toThrow(/fraction/i);
  });

  it("rejects duplicate sector selections", async () => {
    const { privatizeAsset } = await import("./privatizeAsset");
    await expect(
      privatizeAsset(db as unknown as Db, {
        countryId: "US",
        sourceNationalCorporationId: natCorpId,
        selections: [
          { sectorId, carveFraction: 0.5 },
          { sectorId, carveFraction: 0.5 },
        ],
        newCorpName: "Dup Co",
        goldenSharePercent: 0,
        method: "ipo",
        turn: 1,
      })
    ).rejects.toThrow(/duplicate/i);
  });

  it("rejects a non-state-owned source", async () => {
    db.collectionMocks.corporations.findOne.mockImplementation(
      async (q: Record<string, unknown>) => {
        if (q._id && (q._id as ObjectId).equals?.(natCorpId)) {
          return { _id: natCorpId, countryId: "US", ownershipState: "private" };
        }
        return null;
      }
    );
    const { privatizeAsset } = await import("./privatizeAsset");
    await expect(
      privatizeAsset(db as unknown as Db, {
        countryId: "US",
        sourceNationalCorporationId: natCorpId,
        selections: [{ sectorId, carveFraction: 0.3 }],
        newCorpName: "Private Source Co",
        goldenSharePercent: 0,
        method: "ipo",
        turn: 1,
      })
    ).rejects.toThrow(/National Corporation/i);
  });
});
