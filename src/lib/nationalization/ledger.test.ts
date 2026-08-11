import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["CNY", 7]])),
  anchorToCorpCapital: (amount: number, _code: string, rate: number) => amount * rate,
}));

describe("recordNationalizationLedger", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("nationalizationLedger");
  });

  it("inserts a ledger row with a generated _id and createdAt", async () => {
    const natCorpId = new ObjectId();
    const { recordNationalizationLedger } = await import("./ledger");
    await recordNationalizationLedger(db as unknown as Db, {
      countryId: "US",
      nationalCorporationId: natCorpId,
      kind: "nationalize_whole",
      method: "legislative",
      triggers: ["monopoly"],
      tier: "fair",
      valuationAnchor: 1000,
      compensationAnchor: 800,
      sectorTypes: ["energy"],
      formerCorpName: "MonopolyCo",
      foreignOwnerCountryId: null,
      confidenceBefore: 70,
      confidenceAfter: 66,
      legitimacyDelta: 0,
      turn: 12,
    });

    const ins = db.collectionMocks.nationalizationLedger.insertOne.mock.calls[0][0];
    expect(ins._id).toBeInstanceOf(ObjectId);
    expect(ins.createdAt).toBeInstanceOf(Date);
    expect(ins.kind).toBe("nationalize_whole");
    expect(ins.nationalCorporationId).toEqual(natCorpId);
    expect(ins.valuationAnchor).toBe(1000);
  });

  it("getNationalizationLedger queries by NatCorp id, newest first", async () => {
    const natCorpId = new ObjectId();
    const cursor = {
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
    };
    db.collectionMocks.nationalizationLedger.find.mockReturnValue(cursor);
    const { getNationalizationLedger } = await import("./ledger");
    await getNationalizationLedger(db as unknown as Db, natCorpId);
    // Per-corp acquisition read excludes privatization rows (those are divestitures,
    // not acquisitions) so the Holdings "how acquired" grouping stays correct.
    expect(db.collectionMocks.nationalizationLedger.find).toHaveBeenCalledWith({
      nationalCorporationId: natCorpId,
      kind: { $in: ["nationalize_sector", "nationalize_whole"] },
    });
    expect(cursor.sort).toHaveBeenCalledWith({ turn: -1, createdAt: -1 });
  });

  it("getCountryNationalizationLedger queries by country across all NatCorps, newest first", async () => {
    // Two rows for the same country routed into DIFFERENT NatCorps — both returned.
    const rows = [
      { nationalCorporationId: new ObjectId(), countryId: "CN", turn: 20 },
      { nationalCorporationId: new ObjectId(), countryId: "CN", turn: 12 },
    ];
    const cursor = {
      toArray: vi.fn().mockResolvedValue(rows),
      sort: vi.fn().mockReturnThis(),
    };
    db.collectionMocks.nationalizationLedger.find.mockReturnValue(cursor);
    const { getCountryNationalizationLedger } = await import("./ledger");
    const result = await getCountryNationalizationLedger(db as unknown as Db, "CN");
    expect(db.collectionMocks.nationalizationLedger.find).toHaveBeenCalledWith({ countryId: "CN" });
    expect(cursor.sort).toHaveBeenCalledWith({ turn: -1, createdAt: -1 });
    expect(result).toHaveLength(2);
  });
});

describe("resolveActualPayoutLocal", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("nationalizationLedger");
    db.collection("exchangeRates");
  });

  it("sums sector ledger compensation and converts ₳ → local currency", async () => {
    db.collectionMocks.nationalizationLedger.find.mockReturnValue({
      toArray: async () => [
        { compensationAnchor: 100, sectorTypes: ["energy"], countryId: "CN" },
        { compensationAnchor: 62, sectorTypes: ["energy"], countryId: "CN" },
      ],
    });
    const { resolveActualPayoutLocal } = await import("./ledger");
    const res = await resolveActualPayoutLocal(db as unknown as Db, {
      countryId: "CN",
      currency: "CNY",
      sectorType: "energy",
    });
    expect(db.collectionMocks.nationalizationLedger.find).toHaveBeenCalledWith({
      countryId: "CN",
      kind: "nationalize_sector",
      sectorTypes: "energy",
    });
    expect(res).toBe((100 + 62) * 7); // anchor sum × CNY rate
  });

  it("matches a whole-corp taking by formerCorpName (zero payout is still returned)", async () => {
    db.collectionMocks.nationalizationLedger.find.mockReturnValue({
      toArray: async () => [{ compensationAnchor: 0, formerCorpName: "BYD", countryId: "CN" }],
    });
    const { resolveActualPayoutLocal } = await import("./ledger");
    const res = await resolveActualPayoutLocal(db as unknown as Db, {
      countryId: "CN",
      currency: "CNY",
      corpName: "BYD",
    });
    expect(db.collectionMocks.nationalizationLedger.find).toHaveBeenCalledWith({
      countryId: "CN",
      kind: "nationalize_whole",
      formerCorpName: "BYD",
    });
    expect(res).toBe(0);
  });

  it("returns undefined when no taking has been recorded yet", async () => {
    db.collectionMocks.nationalizationLedger.find.mockReturnValue({ toArray: async () => [] });
    const { resolveActualPayoutLocal } = await import("./ledger");
    const res = await resolveActualPayoutLocal(db as unknown as Db, {
      countryId: "CN",
      currency: "CNY",
      sectorType: "energy",
    });
    expect(res).toBeUndefined();
  });
});
