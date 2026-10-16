import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { GET, getCommodityDetailData } from "./route";
import { buildCommodityMarketScope } from "@/app/commodity/[type]/lib/marketScope";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 91 }),
}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn().mockResolvedValue({ isAdmin: true }),
}));

const corpId = new ObjectId();

describe("advertising commodity detail", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("commodityPrices").findOne.mockResolvedValue({
      basePrice: 100,
      globalPrice: 100,
      globalDemand: 1000,
      turn: 91,
    });
    db.collection("gameConfig").findOne.mockResolvedValue({ marketSystemMode: "plants" });
    db.collection("corporations")
      .find()
      .toArray.mockResolvedValue([
        { _id: corpId, name: "Retailer", type: "retail", countryId: "US", marketingBudget: 1e12 },
      ]);
    db.collection("corporateSectors")
      .find()
      .toArray.mockResolvedValue([
        {
          corporationId: corpId,
          sectorType: "retail",
          stateId: "CA",
          countryId: "US",
          revenue: 400_000,
          strategyId: "standard",
          producedUnits: 1000,
          operatingCapacityUnits: 1000,
        },
      ]);
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([{ _id: "CA", countryId: "US" }]);
  });

  it("reports only the global residual, even when configured budgets exceed stored demand", async () => {
    const response = await GET(new Request("http://localhost/api/commodities/advertising"), {
      params: Promise.resolve({ type: "advertising" }),
    });
    expect(response.status).toBe(200);
    const data: Awaited<ReturnType<typeof getCommodityDetailData>> = await response.json();
    const plantDemand = data.topConsumers.reduce((sum, row) => sum + row.units, 0);
    const residual = data.demandDriver?.sourceUnits ?? -1;

    expect(plantDemand).toBeGreaterThan(0);
    expect(residual).toBeCloseTo(1000 - plantDemand, 1);
    expect(residual).toBeLessThanOrEqual(data.globalDemand);
    expect(data.demandDriver?.sourceLabel).toBe("Other global demand (including marketing)");
    expect(data.demandDriver?.sourceShare).toBeCloseTo((residual / 1000) * 100, 1);
    expect(data.demandDriver?.description).toContain("not an exact marketing total");
    expect(data.syntheticDemandSources).toEqual([
      expect.objectContaining({ name: "Other demand (including marketing)", units: residual }),
    ]);
    expect(data).not.toHaveProperty("advertisingBudgetDemand");
  });

  it("keeps corporate consumption on the plant-input basis when budgets change", async () => {
    const withBudget = await getCommodityDetailData("advertising");
    db.collection("corporations")
      .find()
      .toArray.mockResolvedValue([
        { _id: corpId, name: "Retailer", type: "retail", countryId: "US", marketingBudget: 0 },
      ]);
    const withoutBudget = await getCommodityDetailData("advertising");

    expect(withBudget.topConsumers).toEqual(withoutBudget.topConsumers);
    expect(withBudget.topConsumersByCountry.US).toEqual(withoutBudget.topConsumersByCountry.US);
    expect(withBudget.demandDriver).toEqual(withoutBudget.demandDriver);
    expect(withBudget.syntheticDemandSources).toEqual(withoutBudget.syntheticDemandSources);
  });

  it("clamps a negative residual to zero", async () => {
    db.collection("commodityPrices").findOne.mockResolvedValue({ basePrice: 100, globalDemand: 1 });
    const data = await getCommodityDetailData("advertising");

    expect(data.demandDriver?.sourceUnits).toBe(0);
    expect(data.demandDriver?.sourceShare).toBe(0);
    expect(data.syntheticDemandSources).toEqual([]);
  });

  it("does not reconstruct quantities for the light header response", async () => {
    const data = await getCommodityDetailData("advertising", { includeHeavy: false });

    expect(data.demandDriver).not.toHaveProperty("sourceUnits");
    expect(data.demandDriver).not.toHaveProperty("sourceShare");
    expect(data.syntheticDemandSources).toEqual([]);
  });

  it.each([1000, 0])(
    "handles a market without plant consumers at total demand %s",
    async (total) => {
      db.collection("corporateSectors").find().toArray.mockResolvedValue([]);
      db.collection("commodityPrices").findOne.mockResolvedValue({
        basePrice: 100,
        globalDemand: total,
      });
      const data = await getCommodityDetailData("advertising");

      expect(data.topConsumers).toEqual([]);
      expect(data.demandDriver?.sourceUnits).toBe(total);
      expect(data.demandDriver?.sourceShare).toBe(total > 0 ? 100 : 0);
      expect(data.syntheticDemandSources).toHaveLength(total > 0 ? 1 : 0);
    }
  );

  it("keeps the residual global instead of attributing it to country or state markets", async () => {
    const data = await getCommodityDetailData("advertising");

    expect(buildCommodityMarketScope(data, null).syntheticDemandSources).toEqual(
      data.syntheticDemandSources
    );
    expect(buildCommodityMarketScope(data, "US").syntheticDemandSources).toEqual([]);
    expect(buildCommodityMarketScope(data, "US", "CA").syntheticDemandSources).toEqual([]);
    expect(data.demandDriver?.sourceLabel).toContain("global");
  });
});
