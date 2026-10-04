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
const sector = { _id: sectorId, corporationId: corpId, sectorType: "manufacturing" };
const params = Promise.resolve({ id: corpId.toString(), sectorId: sectorId.toString() });
const request = (body: object) =>
  new Request("http://localhost/pricing", { method: "POST", body: JSON.stringify(body) });

describe("industrial pricing command", () => {
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

  it("preserves legacy pricing without reading the new feature gate", async () => {
    const response = await setSectorPricing(request({ pricingPosture: 0.1 }), { params });
    expect(response.status).toBe(200);
    expect(db.collectionMocks.gameConfig.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.updateOne.mock.calls[0][1].$set).not.toHaveProperty(
      "pricingMode"
    );
  });

  it("refuses cost-plus while disabled without writing the sector", async () => {
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ explicitPlantCostsEnabled: false });
    const response = await setSectorPricing(
      request({ pricingPosture: 0.1, pricingMode: "costPlus" }),
      { params }
    );
    expect(response.status).toBe(400);
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
  });

  it("refuses nonindustrial cost-plus", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      ...sector,
      sectorType: "financial",
    });
    expect(
      (
        await setSectorPricing(request({ pricingPosture: 0.1, pricingMode: "costPlus" }), {
          params,
        })
      ).status
    ).toBe(400);
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
  });

  it("persists a valid owner choice within the owning corporation", async () => {
    expect(
      (
        await setSectorPricing(request({ pricingPosture: 0.1, pricingMode: "costPlus" }), {
          params,
        })
      ).status
    ).toBe(200);
    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalledWith(
      { _id: sectorId, corporationId: corpId },
      { $set: { pricingMode: "costPlus", pricingPosture: 0.1, updatedAt: expect.any(Date) } }
    );
  });

  it("refuses a non-CEO before reading or writing the sector", async () => {
    vi.mocked(requireCeo).mockReturnValue(new Response("Forbidden", { status: 403 }) as never);
    expect(
      (
        await setSectorPricing(request({ pricingPosture: 0.1, pricingMode: "costPlus" }), {
          params,
        })
      ).status
    ).toBe(403);
    expect(db.collectionMocks.corporateSectors.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.updateOne).not.toHaveBeenCalled();
  });
});
