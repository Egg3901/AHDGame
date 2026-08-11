import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["CNY", 1]])),
}));
vi.mock("@/lib/currency/govBudgetFields", () => ({ writeGovBudgetLocal: (v: number) => v }));
vi.mock("@/lib/bonds/corporateBondDefault", () => ({
  buildPrimeRateMap: vi.fn(() => new Map()),
  computeSectorNpvSum: vi.fn(() => 1000),
}));
vi.mock("./compensation", () => ({
  applyTier: (v: number) => v,
  sectorCompensationValuationAnchor: (
    _sector: unknown,
    npvAnchor: number,
    opts: { fraction?: number }
  ) => npvAnchor * (opts.fraction ?? 1),
}));
vi.mock("./nationalCorporation", () => ({
  isStateOwned: (c: { countryOwnerId?: string }) => !!c?.countryOwnerId,
}));

function cursor<T>(rows: T[]) {
  const c = { toArray: vi.fn().mockResolvedValue(rows), project: vi.fn(() => c) };
  return c;
}

const playerCorpId = new ObjectId();
const stateCorpId = new ObjectId();

describe("computeSectorNationalizationPreview", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["centralBanks", "corporateSectors", "corporations", "unownedSectors"])
      db.collection(n);
    db.collectionMocks.centralBanks.find.mockReturnValue(cursor([]));
    // Corps for the sector pool are fetched in ONE batched `$in` query; this
    // was a findOne per corp (perf audit 2026-08-03). The mock answers from the
    // requested id list so the query-count guard below stays honest.
    db.collectionMocks.corporations.find.mockImplementation((q: { _id?: { $in?: ObjectId[] } }) => {
      const known = [
        { _id: playerCorpId, name: "Tech Co", liquidCurrencyCode: "CNY" },
        { _id: stateCorpId, name: "State Co", countryOwnerId: "CN" },
      ];
      const requested = (q?._id?.$in ?? []).map((id) => id.toString());
      return cursor(known.filter((c) => requested.includes(c._id.toString())));
    });
  });

  it("estimates per-corp compensation + free unowned slice, skipping state-owned", async () => {
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        { _id: new ObjectId(), corporationId: playerCorpId, stateId: "DB", revenue: 100 },
        { _id: new ObjectId(), corporationId: playerCorpId, stateId: "HB", revenue: 100 },
        { _id: new ObjectId(), corporationId: stateCorpId, stateId: "XB", revenue: 999 },
      ])
    );
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      cursor([{ _id: new ObjectId(), stateId: "DB", revenue: 500 }])
    );

    const { computeSectorNationalizationPreview } = await import("./billTargetPreview");
    const res = await computeSectorNationalizationPreview(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 1,
      scope: "all",
      currentTurn: 5,
    });

    expect(res.affectedCount).toBe(1);
    // Perf guard: one batched corp fetch for the whole pool, never per-corp.
    expect(db.collectionMocks.corporations.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.find).toHaveBeenCalledTimes(1);
    expect(res.affectedCorps[0]).toMatchObject({
      name: "Tech Co",
      sectorCount: 2,
      regionCount: 2,
      estCompensationLocal: 2000,
    });
    expect(res.totalCompensationLocal).toBe(2000);
    expect(res.unownedSliceRevenuePerTurn).toBe(500);
  });

  it("excludes a corp within the re-nationalization cooldown", async () => {
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([
        {
          _id: playerCorpId,
          name: "Recently Privatized Co",
          liquidCurrencyCode: "CNY",
          privatizedAtTurn: 5,
        },
      ])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([{ _id: new ObjectId(), corporationId: playerCorpId, stateId: "DB", revenue: 100 }])
    );
    db.collectionMocks.unownedSectors.find.mockReturnValue(cursor([]));

    const { computeSectorNationalizationPreview } = await import("./billTargetPreview");
    const res = await computeSectorNationalizationPreview(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 1,
      scope: "corporations",
      currentTurn: 5,
    });
    expect(res.affectedCount).toBe(0);
    expect(res.totalCompensationLocal).toBe(0);
  });

  it("scope=unowned reports no affected corps and the half slice", async () => {
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([]));
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      cursor([{ _id: new ObjectId(), stateId: "DB", revenue: 400 }])
    );
    const { computeSectorNationalizationPreview } = await import("./billTargetPreview");
    const res = await computeSectorNationalizationPreview(db as unknown as Db, {
      countryId: "CN",
      sectorType: "technology",
      carveFraction: 0.5,
      scope: "unowned",
      currentTurn: 5,
    });
    expect(res.affectedCount).toBe(0);
    expect(res.totalCompensationLocal).toBe(0);
    expect(res.unownedSliceRevenuePerTurn).toBe(200);
  });
});

describe("computeNationalizationProvisionDetail", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of ["centralBanks", "corporateSectors", "corporations", "unownedSectors"])
      db.collection(n);
    db.collectionMocks.centralBanks.find.mockReturnValue(cursor([]));
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([]));
    db.collectionMocks.unownedSectors.find.mockReturnValue(cursor([]));
  });

  it("wraps a sector-wide taking as { kind: 'sector' }", async () => {
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: playerCorpId,
      name: "Tech Co",
      liquidCurrencyCode: "CNY",
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([{ _id: new ObjectId(), corporationId: playerCorpId, stateId: "DB", revenue: 100 }])
    );
    const { computeNationalizationProvisionDetail } = await import("./billTargetPreview");
    const res = await computeNationalizationProvisionDetail(
      db as unknown as Db,
      "CN",
      { targetSectorType: "technology", sectorCarveFraction: 1, sectorScope: "all" },
      5
    );
    expect(res?.kind).toBe("sector");
  });

  it("returns undefined for a provision with no renderable target", async () => {
    const { computeNationalizationProvisionDetail } = await import("./billTargetPreview");
    const res = await computeNationalizationProvisionDetail(db as unknown as Db, "CN", {}, 5);
    expect(res).toBeUndefined();
  });

  it("returns undefined for an already-state-owned whole-corp target", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      name: "State Co",
      countryId: "CN",
      countryOwnerId: "CN", // state-owned ⇒ isStateOwned() true
    });
    const { computeNationalizationProvisionDetail } = await import("./billTargetPreview");
    const res = await computeNationalizationProvisionDetail(
      db as unknown as Db,
      "CN",
      { targetCorporationId: corpId },
      5
    );
    expect(res).toBeUndefined();
  });
});
