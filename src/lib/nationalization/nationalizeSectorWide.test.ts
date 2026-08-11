import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/corporationCapital", () => {
  // Inlined inside the factory: vi.mock is hoisted above outer consts.
  const COUNTRY_CCY: Record<string, string> = { CN: "CNY", UK: "GBP", US: "USD", NG: "NGN" };
  const hostCode = (sector?: { countryId?: string }, corp?: { countryId?: string }) => {
    const c = sector?.countryId ?? corp?.countryId;
    return c ? COUNTRY_CCY[c] : undefined;
  };
  return {
    loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
    anchorToCorpLiquidCapital: (v: number) => v,
    resolveSectorHostCurrencyCode: hostCode,
    fxRateForSectorHostFromMap: (
      sector?: { countryId?: string },
      corp?: { countryId?: string },
      map?: Map<string, number>
    ) => {
      const code = hostCode(sector, corp);
      return (code && map?.get(code)) || 1;
    },
  };
});
vi.mock("@/lib/bonds/corporateBondDefault", () => ({
  buildPrimeRateMap: vi.fn(() => new Map()),
  computeSectorNpvSum: vi.fn(() => 1000), // each sector worth 1000 ₳
}));
vi.mock("./nationalCorporation", () => ({
  resolveNationalCorporationForSector: vi.fn().mockResolvedValue({ _id: new ObjectId() }),
  isStateOwned: (c: { countryOwnerId?: string; ownershipState?: string }) =>
    !!c?.countryOwnerId || c?.ownershipState === "stateOwned",
}));
vi.mock("./compensation", () => ({
  applyTier: (v: number) => v, // fair ⇒ ×1
  // D11 base selector: below plants it is the NPV the caller computed.
  sectorCompensationValuationAnchor: (
    _sector: unknown,
    npvAnchor: number,
    opts: { fraction?: number }
  ) => npvAnchor * (opts.fraction ?? 1),
}));
vi.mock("./treasury", () => ({ debitTreasuryCompensation: vi.fn().mockResolvedValue(0) }));
vi.mock("./consequences/apply", () => ({
  applyNationalizationConsequences: vi
    .fn()
    .mockResolvedValue({ confidenceBefore: 70, confidenceAfter: 68, legitimacyDelta: 0 }),
}));
vi.mock("./ledger", () => ({ recordNationalizationLedger: vi.fn().mockResolvedValue(undefined) }));
// Anchor↔local conversion mirrors production: divide local→₳, multiply ₳→local by
// the fx rate (local-per-₳). USD (rate 1) stays identity so the headroom assertions
// hold; a real rate exercises the cross-currency carve conversion.
vi.mock("@/lib/currency/corpEconomyFields", () => ({
  readCorpEconomicAnchor: (v: number, _code?: string, rate?: number) =>
    typeof rate === "number" && rate > 0 ? v / rate : v,
  writeCorpEconomicLocal: (v: number, _code?: string, rate?: number) =>
    typeof rate === "number" && rate > 0 ? v * rate : v,
}));
vi.mock("@/lib/corporations/marketShare", () => ({
  gdpDerivedMarketAnchor: vi.fn((gdp: number) => gdp),
}));

function cursor<T>(rows: T[]) {
  const c = { toArray: vi.fn().mockResolvedValue(rows), project: vi.fn(() => c) };
  return c;
}

const playerCorpId = new ObjectId();
const stateCorpId = new ObjectId();
const playerSectorId = new ObjectId();
const stateSectorId = new ObjectId();

const consequence = {
  method: "legislative" as const,
  triggers: ["supermajority" as const],
  turn: 5,
};

describe("nationalizeSectorWide", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["corporateSectors", "corporations", "unownedSectors", "centralBanks"])
      db.collection(n);
    db.collectionMocks.centralBanks.find.mockReturnValue(cursor([]));
    db.collectionMocks.corporations.findOne.mockImplementation((q: { _id: ObjectId }) => {
      if (q._id?.toString() === playerCorpId.toString())
        return Promise.resolve({ _id: playerCorpId, name: "Tech Co", liquidCurrencyCode: "USD" });
      if (q._id?.toString() === stateCorpId.toString())
        return Promise.resolve({ _id: stateCorpId, name: "State Co", countryOwnerId: "CN" });
      return Promise.resolve(null);
    });
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null); // NatCorp has no existing row
    db.collectionMocks.unownedSectors.find.mockReturnValue(cursor([]));
  });

  function seedCorpSectors() {
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: playerSectorId,
          corporationId: playerCorpId,
          countryId: "CN",
          stateId: "DB",
          sectorType: "technology",
          revenue: 100,
          workers: 50,
          currentGrowthCost: 10,
          profitMargin: 25,
        },
        {
          _id: stateSectorId,
          corporationId: stateCorpId,
          countryId: "CN",
          stateId: "HB",
          sectorType: "technology",
          revenue: 200,
          workers: 80,
          currentGrowthCost: 20,
        },
      ])
    );
  }

  it("full carve (100%) of a player corp: compensates, removes the donor row, grows the NatCorp", async () => {
    seedCorpSectors();
    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    const { debitTreasuryCompensation } = await import("./treasury");

    const res = await nationalizeSectorWide(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 1,
      scope: "corporations",
      tier: "fair",
      consequence,
    });

    // Only the player corp's sector is taken; the state-owned one is skipped.
    expect(res.affectedCorps).toBe(1);
    expect(res.sectorsCarved).toBe(1);
    // Compensated 1000 ₳ (NPV × fraction × fair) to the donor.
    expect(vi.mocked(debitTreasuryCompensation)).toHaveBeenCalledWith(
      db,
      "CN",
      1000,
      expect.anything(),
      expect.any(Date)
    );
    const donorCredit = db.collectionMocks.corporations.updateOne.mock.calls.find(
      (c) => c[0]._id?.toString() === playerCorpId.toString()
    );
    expect(donorCredit?.[1].$inc.liquidCapital).toBe(1000);
    // Full carve removes the donor sector row.
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({
      _id: playerSectorId,
    });
    // State-owned sector untouched (no delete of it).
    expect(db.collectionMocks.corporateSectors.deleteOne).not.toHaveBeenCalledWith({
      _id: stateSectorId,
    });
    // NatCorp gains a new sector (no existing row), with the transition revenue
    // haircut applied (100 carved × 0.85) and the nationalization anchor stamped.
    expect(db.collectionMocks.corporateSectors.insertOne).toHaveBeenCalledTimes(1);
    const inserted = db.collectionMocks.corporateSectors.insertOne.mock.calls[0][0];
    expect(inserted.revenue).toBe(85);
    expect(inserted.nationalizedAtTurn).toBe(5);
  });

  it("carves a foreign-owned UK sector (stored in host GBP) into the GBP NatCorp (regression: t839/t841)", async () => {
    // Regression for the t839/t841 incident. Under host-currency storage a sector
    // physically in the UK is denominated in GBP regardless of its owner's home
    // currency (here an NGN corp, "Whitley"). The carve therefore reads the donor
    // sector at the GBP host rate (0.625/₳) and writes into the GBP NatCorp at the
    // same rate — no NGN ever touches the sector value. Pre-fix, an owner-currency
    // read copied the raw local number across, flooding the market ~2,300×.
    const { loadFxRatesByCurrency } = await import("@/lib/currency/corporationCapital");
    vi.mocked(loadFxRatesByCurrency).mockResolvedValueOnce(
      new Map([
        ["USD", 1],
        ["NGN", 1449],
        ["GBP", 0.625],
      ])
    );
    const destId = new ObjectId();
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValueOnce({
      _id: destId,
      liquidCurrencyCode: "GBP",
    } as never);
    const donorId = new ObjectId();
    const donorSectorId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockImplementation((q: { _id: ObjectId }) =>
      q._id?.toString() === donorId.toString()
        ? Promise.resolve({ _id: donorId, name: "Whitley", liquidCurrencyCode: "NGN" })
        : Promise.resolve(null)
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: donorSectorId,
          corporationId: donorId,
          countryId: "UK",
          stateId: "LON",
          sectorType: "manufacturing",
          revenue: 625, // £625 = ₳1,000 at GBP 0.625/₳ (host currency)
          workers: 10,
          currentGrowthCost: 6.25, // £6.25 = ₳10
          profitMargin: 20,
        },
      ])
    );
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    db.collectionMocks.unownedSectors.find.mockReturnValue(cursor([]));

    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    await nationalizeSectorWide(db as unknown as Db, {
      countryId: "UK",
      sectorType: "manufacturing",
      carveFraction: 1,
      scope: "corporations",
      tier: "fair",
      consequence,
    });

    const inserted = db.collectionMocks.corporateSectors.insertOne.mock.calls[0][0];
    // ₳ anchor 625/0.625 = 1000; × 0.85 haircut = 850 ₳; × GBP 0.625 = 531.25 → 531.
    expect(inserted.revenue).toBe(531);
    // growth cost ₳ anchor 6.25/0.625 = 10; × GBP 0.625 = 6.25 → 6.
    expect(inserted.currentGrowthCost).toBe(6);
  });

  it("merges into an existing NatCorp sector via $inc without a ReferenceError (regression: growth-cost field)", async () => {
    // The $inc branch (NatCorp already holds a sector in this type/region) was
    // never exercised; a stale `growthCost` reference would throw at runtime.
    seedCorpSectors();
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: new ObjectId(),
      corporationId: new ObjectId(),
      sectorType: "technology",
      stateId: "DB",
      revenue: 500,
    });
    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    await nationalizeSectorWide(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 1,
      scope: "corporations",
      tier: "fair",
      consequence,
    });
    const incCall = db.collectionMocks.corporateSectors.updateOne.mock.calls.find(
      (c: unknown[]) =>
        (c[1] as { $inc?: { currentGrowthCost?: number } })?.$inc?.currentGrowthCost !== undefined
    );
    expect(incCall).toBeDefined();
    expect(
      Number.isFinite(
        (incCall![1] as { $inc: { currentGrowthCost: number } }).$inc.currentGrowthCost
      )
    ).toBe(true);
  });

  it("partial carve (40%) shrinks the donor and carves the slice", async () => {
    seedCorpSectors();
    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    await nationalizeSectorWide(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 0.4,
      scope: "corporations",
      tier: "fair",
      consequence,
    });
    // Donor shrunk to 60% revenue; not deleted.
    const shrink = db.collectionMocks.corporateSectors.updateOne.mock.calls.find(
      (c) => c[0]._id?.toString() === playerSectorId.toString()
    );
    expect(shrink?.[1].$set.revenue).toBe(60); // 100 × 0.6
    expect(db.collectionMocks.corporateSectors.deleteOne).not.toHaveBeenCalled();
  });

  it("skips a donor within the re-nationalization cooldown (spec §13.4)", async () => {
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: playerSectorId,
          corporationId: playerCorpId,
          countryId: "CN",
          stateId: "DB",
          sectorType: "technology",
          revenue: 100,
        },
      ])
    );
    // Just-privatized this turn ⇒ cooldown active ⇒ not swept.
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: playerCorpId,
      name: "Recently Privatized Co",
      liquidCurrencyCode: "USD",
      privatizedAtTurn: 5,
    });
    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    const res = await nationalizeSectorWide(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 1,
      scope: "corporations",
      tier: "fair",
      consequence,
    });
    expect(res.affectedCorps).toBe(0);
    expect(res.sectorsCarved).toBe(0);
    expect(db.collectionMocks.corporateSectors.deleteOne).not.toHaveBeenCalled();
  });

  it("unowned scope carves the unowned market for free (no compensation)", async () => {
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          countryId: "CN",
          stateId: "DB",
          sectorType: "technology",
          revenue: 500,
        },
      ])
    );
    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    const { debitTreasuryCompensation } = await import("./treasury");
    const res = await nationalizeSectorWide(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 1,
      scope: "unowned",
      tier: "fair",
      consequence,
    });
    expect(res.unownedCarved).toBe(1);
    expect(res.affectedCorps).toBe(0);
    expect(vi.mocked(debitTreasuryCompensation)).not.toHaveBeenCalled(); // free
    expect(db.collectionMocks.unownedSectors.deleteOne).toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.insertOne).toHaveBeenCalledTimes(1);
  });

  it("records the sweep scope in the ledger label so a 100%-but-unowned-only taking isn't read as a full nationalization", async () => {
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          countryId: "CN",
          stateId: "DB",
          sectorType: "technology",
          revenue: 500,
        },
      ])
    );
    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    const { recordNationalizationLedger } = await import("./ledger");
    await nationalizeSectorWide(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 1,
      scope: "unowned",
      tier: "fair",
      consequence,
    });
    expect(vi.mocked(recordNationalizationLedger)).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        formerCorpName: expect.stringContaining("Unowned market only"),
      })
    );
  });

  it("fills the GDP headroom to the ceiling so a 100% take reaches 100% ownership", async () => {
    // Parity with splitting: a NatCorp sector sitting below the region's GDP-derived
    // market ceiling gets topped up to the ceiling (no haircut), so the bill view
    // reads 100% owned instead of leaving an uncloseable "unowned" gap.
    const destId = new ObjectId();
    const natSectorId = new ObjectId();
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValueOnce({
      _id: destId,
      liquidCurrencyCode: "USD",
    } as never);

    // Sole holder is the NatCorp (revenue 2000) — step 1 skips it (it IS the dest);
    // step 2b tops it up by ceiling(5000) − owned(2000) = 3000.
    const natSector = {
      _id: natSectorId,
      corporationId: destId,
      sectorType: "technology",
      stateId: "CN_GD",
      revenue: 2000,
    };
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([natSector]));
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    db.collection("states");
    db.collectionMocks.states.find.mockReturnValue(
      cursor([{ _id: "CN_GD", gdp: 5000, countryId: "CN" }])
    );
    db.collectionMocks.unownedSectors.find.mockReturnValue(cursor([]));

    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    await nationalizeSectorWide(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 1,
      scope: "all",
      tier: "fair",
      consequence,
    });

    const fillCall = db.collectionMocks.corporateSectors.updateOne.mock.calls.find(
      (c: unknown[]) => (c[1] as { $inc?: { revenue?: number } })?.$inc?.revenue === 3000
    );
    expect(fillCall).toBeDefined();
    expect(fillCall![0]).toEqual({ _id: natSectorId });
  });

  it("npp_unowned scope carves NPP-run corps + unowned but spares player corps (#89)", async () => {
    const nppCorpId = new ObjectId();
    const nppSectorId = new ObjectId();
    // Player corp is ceoType "character"; NPP corp is ceoType "npp".
    db.collectionMocks.corporations.findOne.mockImplementation((q: { _id: ObjectId }) => {
      if (q._id?.toString() === playerCorpId.toString())
        return Promise.resolve({
          _id: playerCorpId,
          name: "Player Co",
          ceoType: "character",
          liquidCurrencyCode: "USD",
        });
      if (q._id?.toString() === nppCorpId.toString())
        return Promise.resolve({
          _id: nppCorpId,
          name: "NPP Co",
          ceoType: "npp",
          liquidCurrencyCode: "USD",
        });
      return Promise.resolve(null);
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: playerSectorId,
          corporationId: playerCorpId,
          countryId: "CN",
          stateId: "DB",
          sectorType: "technology",
          revenue: 100,
          workers: 50,
        },
        {
          _id: nppSectorId,
          corporationId: nppCorpId,
          countryId: "CN",
          stateId: "HB",
          sectorType: "technology",
          revenue: 200,
          workers: 80,
        },
      ])
    );
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          countryId: "CN",
          stateId: "DB",
          sectorType: "technology",
          revenue: 500,
        },
      ])
    );

    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    const res = await nationalizeSectorWide(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 1,
      scope: "npp_unowned",
      tier: "fair",
      consequence,
    });

    // Only the NPP corp is taken; the player corp is spared. Unowned is swept.
    expect(res.affectedCorps).toBe(1);
    expect(res.sectorsCarved).toBe(1);
    expect(res.unownedCarved).toBe(1);
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({
      _id: nppSectorId,
    });
    expect(db.collectionMocks.corporateSectors.deleteOne).not.toHaveBeenCalledWith({
      _id: playerSectorId,
    });
  });

  it("does not fill headroom when production already meets/exceeds the GDP ceiling", async () => {
    const destId = new ObjectId();
    const { resolveNationalCorporationForSector } = await import("./nationalCorporation");
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValueOnce({
      _id: destId,
      liquidCurrencyCode: "USD",
    } as never);
    const natSector = {
      _id: new ObjectId(),
      corporationId: destId,
      sectorType: "technology",
      stateId: "CN_GD",
      revenue: 8000, // already above the 5000 ceiling
    };
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([natSector]));
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    db.collection("states");
    db.collectionMocks.states.find.mockReturnValue(
      cursor([{ _id: "CN_GD", gdp: 5000, countryId: "CN" }])
    );
    db.collectionMocks.unownedSectors.find.mockReturnValue(cursor([]));

    const { nationalizeSectorWide } = await import("./nationalizeSectorWide");
    await nationalizeSectorWide(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 1,
      scope: "all",
      tier: "fair",
      consequence,
    });

    const fillCall = db.collectionMocks.corporateSectors.updateOne.mock.calls.find(
      (c: unknown[]) => (c[1] as { $inc?: { revenue?: number } })?.$inc?.revenue
    );
    expect(fillCall).toBeUndefined();
  });
});
