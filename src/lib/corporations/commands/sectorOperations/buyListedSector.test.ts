import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  getCorpFxRate: vi.fn().mockResolvedValue(1),
  getSectorHostFxRate: vi.fn().mockResolvedValue(1),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue("USD"),
  resolveSectorHostCurrencyCode: vi.fn().mockReturnValue("USD"),
  anchorToCorpLiquidCapital: vi.fn((anchor: number) => anchor),
}));
vi.mock("@/lib/currency/corpEconomyFields", () => ({
  readCorpEconomicAnchor: vi.fn((value: number) => value),
  writeCorpEconomicLocal: vi.fn((value: number) => value),
}));
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCorpLiquidCapital: vi.fn().mockResolvedValue({ ok: true, newBalance: 0 }),
  refundCorpLiquidCapital: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(5) }));
// These P3b tests are about the plants tier: the plant-state fold only runs at
// or above it (below it, `capitalStock` is capital mode's own derived field and
// must not be summed by a merge). `marketAtLeast` keeps its real ordering.
vi.mock("@/lib/market/featureFlag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/market/featureFlag")>()),
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
}));

let db: MockDb;
const sellerId = new ObjectId();
const buyerId = new ObjectId();
const sectorId = new ObjectId();

const seller = {
  _id: sellerId,
  name: "Seller Corp",
  liquidCapital: 1000,
  liquidCurrencyCode: "USD",
};
const buyer = {
  _id: buyerId,
  name: "Buyer Corp",
  userId: "user-1",
  ceoVacant: false,
  liquidCapital: 5000,
  liquidCurrencyCode: "USD",
};
const sectorBase = {
  _id: sectorId,
  corporationId: sellerId,
  stateId: "CA",
  sectorType: "tech",
  revenue: 100,
  workers: 10,
  profitMargin: 0.2,
  currentGrowthCost: 50,
  forSale: { priceAnchor: 1000 },
};

async function wireCommonMocks() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId: "user-1" } } as never);

  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: seller } as never);

  db.collectionMocks.corporations.findOne.mockResolvedValue(buyer);
  db.collectionMocks.states.findOne.mockResolvedValue({ name: "California" });
}

function makeRequest() {
  return new Request("http://localhost/api/corporations/1/sectors/2/buy", {
    method: "POST",
    body: JSON.stringify({ buyerCorporationId: buyerId.toString() }),
  });
}

const params = Promise.resolve({ id: sellerId.toString(), sectorId: sectorId.toString() });

describe("buyListedSector — transaction log types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("states");
  });

  it("emits a Sector Purchase for the buyer and a Sector Sale for the seller (transfer path)", async () => {
    await wireCommonMocks();

    // First findOne resolves the listed sector; second (existing-buyer-sector) is null → transfer path.
    db.collectionMocks.corporateSectors.findOne
      .mockResolvedValueOnce({ ...sectorBase })
      .mockResolvedValueOnce(null);
    db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 1 });

    const { buyListedSector } = await import("./buyListedSector");
    const res = await buyListedSector(makeRequest(), { params });
    expect(res.status).toBe(200);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const calls = vi.mocked(emitTx).mock.calls.map((c) => c[1]);
    const buyerTx = calls.find((c) => (c.subjectId as ObjectId)?.equals(buyerId));
    const sellerTx = calls.find((c) => (c.subjectId as ObjectId)?.equals(sellerId));

    expect(buyerTx?.type).toBe("corp_sector_purchase");
    expect(sellerTx?.type).toBe("corp_sector_sale");
  });

  it("emits a Sector Purchase for the buyer and a Sector Sale for the seller (merge path)", async () => {
    await wireCommonMocks();

    const existingBuyerSector = {
      _id: new ObjectId(),
      corporationId: buyerId,
      stateId: "CA",
      sectorType: "tech",
      revenue: 200,
      workers: 5,
      profitMargin: 0.1,
      currentGrowthCost: 20,
    };
    db.collectionMocks.corporateSectors.findOne
      .mockResolvedValueOnce({ ...sectorBase })
      .mockResolvedValueOnce(existingBuyerSector);
    db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.corporateSectors.deleteOne.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 1 });

    const { buyListedSector } = await import("./buyListedSector");
    const res = await buyListedSector(makeRequest(), { params });
    expect(res.status).toBe(200);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    const calls = vi.mocked(emitTx).mock.calls.map((c) => c[1]);
    const buyerTx = calls.find((c) => (c.subjectId as ObjectId)?.equals(buyerId));
    const sellerTx = calls.find((c) => (c.subjectId as ObjectId)?.equals(sellerId));

    expect(buyerTx?.type).toBe("corp_sector_purchase");
    expect(sellerTx?.type).toBe("corp_sector_sale");
  });
});

describe("buyListedSector — mid-build transfer moves the queue (P3b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("corporateSectors");
    db.collection("states");
  });

  // A sector bought mid-build: 300 units standing, one order in flight for 120
  // more units that cost ₳4,000,000 and lands on turn 30.
  const midBuildSector = {
    ...sectorBase,
    capitalStock: 300,
    buildQueue: [{ unitsOrdered: 120, costPaidAnchor: 4_000_000, startTurn: 20, onlineTurn: 30 }],
    constructionInProgressAnchor: 4_000_000,
    mothballed: false,
    plantsStartTurn: 12,
  };

  it("transfer path: the doc is re-pointed, so the queue and CIP ride along untouched", async () => {
    await wireCommonMocks();
    db.collectionMocks.corporateSectors.findOne
      .mockResolvedValueOnce({ ...midBuildSector })
      .mockResolvedValueOnce(null);
    db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 1 });

    const { buyListedSector } = await import("./buyListedSector");
    expect((await buyListedSector(makeRequest(), { params })).status).toBe(200);

    const transferUpdate = db.collectionMocks.corporateSectors.updateOne.mock.calls[0][1];
    // Ownership moves; the plant fields are NOT rewritten (nothing to rewrite —
    // they live on the same doc).
    expect(transferUpdate.$set.corporationId).toEqual(buyerId);
    expect(transferUpdate.$set).not.toHaveProperty("buildQueue");
    expect(transferUpdate.$set).not.toHaveProperty("constructionInProgressAnchor");
  });

  it("merge path: capacity, build queue and CIP are folded into the survivor, not destroyed", async () => {
    await wireCommonMocks();

    const existingBuyerSector = {
      _id: new ObjectId(),
      corporationId: buyerId,
      stateId: "CA",
      sectorType: "tech",
      revenue: 200,
      workers: 5,
      profitMargin: 0.1,
      currentGrowthCost: 20,
      capitalStock: 500,
      buildQueue: [{ unitsOrdered: 50, costPaidAnchor: 1_000_000, startTurn: 22, onlineTurn: 34 }],
      constructionInProgressAnchor: 1_000_000,
      mothballed: false,
      plantsStartTurn: 40,
    };
    db.collectionMocks.corporateSectors.findOne
      .mockResolvedValueOnce({ ...midBuildSector })
      .mockResolvedValueOnce(existingBuyerSector);
    db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.corporateSectors.deleteOne.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks.corporations.updateOne.mockResolvedValue({ matchedCount: 1 });

    const { buyListedSector } = await import("./buyListedSector");
    expect((await buyListedSector(makeRequest(), { params })).status).toBe(200);

    // The merge update is the one that targets the surviving buyer sector.
    const mergeCall = db.collectionMocks.corporateSectors.updateOne.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { _id?: ObjectId })._id?.toString() === existingBuyerSector._id.toString()
    );
    expect(mergeCall).toBeDefined();
    const set = (mergeCall as unknown[])[1] as Record<string, Record<string, unknown>>;
    const merged = set.$set;

    // Capacity summed — the bought plants exist on the survivor.
    expect(merged.capitalStock).toBe(800);
    // Both in-flight orders survive, oldest landing first.
    expect((merged.buildQueue as { onlineTurn: number }[]).map((o) => o.onlineTurn)).toEqual([
      30, 34,
    ]);
    // ₳ CIP summed, NOT re-denominated through either corp's currency.
    expect(merged.constructionInProgressAnchor).toBe(5_000_000);
    expect(
      (merged.buildQueue as { costPaidAnchor: number }[]).map((o) => o.costPaidAnchor)
    ).toEqual([4_000_000, 1_000_000]);
    // Ramp anchor keeps the earlier turn so the governor does not restart.
    expect(merged.plantsStartTurn).toBe(12);
    // And the purchased doc is the one deleted.
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({
      _id: sectorId,
    });
  });
});
