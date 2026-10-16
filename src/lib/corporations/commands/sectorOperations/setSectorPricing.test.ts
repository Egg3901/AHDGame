import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCeo, resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { setSectorPricing } from "./setSectorPricing";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  requireCeo: vi.fn(),
  resolveCorporation: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/market/featureFlag", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/market/featureFlag")>()),
  getMarketSystemMode: vi.fn().mockResolvedValue("plants"),
}));

let db: MockDb;
const corpId = new ObjectId();
const sectorId = new ObjectId();
const sector = {
  _id: sectorId,
  corporationId: corpId,
  sectorType: "manufacturing",
  costPlusCostBasis: { inputCostShare: 0.67, fixedCostShare: 0.238, turn: 12 },
};
const params = Promise.resolve({ id: corpId.toString(), sectorId: sectorId.toString() });
const request = (body: object) =>
  new Request("http://localhost/pricing", { method: "POST", body: JSON.stringify(body) });

describe("producer pricing command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporateSectors");
    db.collection("gameConfig");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId: "owner" } } as never);
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(sector);
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ explicitPlantCostsEnabled: true });
  });

  it.each(["manufacturing", "financial"])(
    "accepts cost-plus for %s without a prior cost basis",
    async (sectorType) => {
      db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
        ...sector,
        sectorType,
        costPlusCostBasis: undefined,
      });
      const quotes = { financial_services: { kind: "costPlus", markup: 0.1 } };
      const response = await setSectorPricing(request({ quotes }), { params });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, quotes });
      expect(db.collectionMocks.gameConfig.findOne).not.toHaveBeenCalled();
      expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalledWith(
        { _id: sectorId, corporationId: corpId },
        { $set: { producerQuotes: quotes, updatedAt: expect.any(Date) } }
      );
    }
  );

  it("saves per-product fixed and automatic prices without changing settled receipts", async () => {
    const quotes = {
      financial_services: { kind: "manual", unitPrice: 4 },
      energy: { kind: "automatic", targetMarkup: 0.15 },
    };
    expect((await setSectorPricing(request({ quotes }), { params })).status).toBe(200);
    const update = db.collectionMocks.corporateSectors.updateOne.mock.calls[0][1];
    expect(update.$set.producerQuotes).toEqual(quotes);
    expect(update.$set).not.toHaveProperty("producerSettlement");
  });

  it.each([
    { pricingPosture: 0.1, pricingMode: "costPlus" },
    { quotes: { invented: { kind: "manual", unitPrice: 1 } } },
    { quotes: { financial_services: { kind: "manual", unitPrice: -1 } } },
    { quotes: { financial_services: { kind: "costPlus", markup: -1.1 } } },
    { quotes: { financial_services: { kind: "automatic", targetMarkup: 1e100 } } },
    { quotes: { financial_services: { kind: "manual", unitPrice: 1, revenueMultiplier: 2 } } },
  ])("rejects invalid quote policies: %j", async (body) => {
    expect((await setSectorPricing(request(body), { params })).status).toBe(400);
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
  });

  it("returns a conflict if ownership changes before the write", async () => {
    db.collectionMocks.corporateSectors.updateOne.mockResolvedValue({ matchedCount: 0 });
    expect((await setSectorPricing(request({ quotes: {} }), { params })).status).toBe(409);
  });

  it("does not write a sector owned by another corporation", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    expect((await setSectorPricing(request({ quotes: {} }), { params })).status).toBe(404);
    expect(db.collectionMocks.corporateSectors.findOne).toHaveBeenCalledWith(
      { _id: sectorId, corporationId: corpId },
      { projection: { _id: 1 } }
    );
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a non-CEO before reading or writing the sector", async () => {
    vi.mocked(requireCeo).mockReturnValue(new Response("Forbidden", { status: 403 }) as never);
    expect(
      (
        await setSectorPricing(
          request({ quotes: { financial_services: { kind: "costPlus", markup: 0.1 } } }),
          {
            params,
          }
        )
      ).status
    ).toBe(403);
    expect(db.collectionMocks.corporateSectors.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
  });
});
