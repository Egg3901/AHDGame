/**
 * SP5 §7 — the metric engine's persist split: macro paths land on macroMetrics
 * and NEVER on stateMetrics (distinct mocks here, unlike the aliased engine
 * behavior fixtures).
 */
import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { resetCorpFxRateCacheForTests } from "@/lib/currency/corporationCapital";
import { runMetricEngine } from "@/lib/metricEngine/phase";

type Op = { updateOne: { filter: { _id: string }; update: { $set: Record<string, number> } } };

describe("runMetricEngine — SP5 store separation", () => {
  it("writes economic fields to macroMetrics only; stateMetrics receives no macro paths", async () => {
    vi.clearAllMocks();
    resetCorpFxRateCacheForTests();
    const db = createMockDb();
    const setup = <T>(name: string, data: T[]) => {
      db.collection(name);
      db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
        toArray: vi.fn().mockResolvedValue(data),
      });
    };
    setup("states", [{ _id: "s1", name: "s1", countryId: "US", population: 100, gdp: 1000 }]);
    setup("corporateSectors", [
      { _id: "secA", stateId: "s1", revenue: 1000, currentGrowthRate: 3, corporationId: undefined },
    ]);
    setup("unownedSectors", []);
    setup("stateMetrics", []);
    setup("macroMetrics", [
      { _id: "s1", economic: { gdpGrowth: { value: 2.5 }, unemploymentRate: { value: 5 } } },
    ]);
    setup("corporations", []);
    setup("exchangeRates", []);
    setup("centralBanks", []);
    setup("governmentApprovals", []);
    setup("federalBudget", [{ _id: "federal", countryId: "US", taxRates: { salesTax: 0 } }]);
    setup("stateBudgets", []);

    const stateOps: Op[] = [];
    const macroOps: Op[] = [];
    db.collectionMocks.stateMetrics!.bulkWrite = vi.fn().mockImplementation((o: Op[]) => {
      stateOps.push(...o);
      return Promise.resolve({ ok: 1 });
    });
    db.collectionMocks.macroMetrics!.bulkWrite = vi.fn().mockImplementation((o: Op[]) => {
      macroOps.push(...o);
      return Promise.resolve({ ok: 1 });
    });
    db.collection("states");
    db.collectionMocks.states!.bulkWrite = vi.fn().mockResolvedValue({ ok: 1 });

    await runMetricEngine(db as unknown as Db, 10);

    const macroSet = Object.assign(
      {},
      ...macroOps.filter((o) => o.updateOne.filter._id === "s1").map((o) => o.updateOne.update.$set)
    ) as Record<string, number>;
    expect(typeof macroSet["economic.gdpGrowth.value"]).toBe("number");
    expect(typeof macroSet["economic.unemploymentRate.value"]).toBe("number");

    for (const op of stateOps) {
      for (const key of Object.keys(op.updateOne.update.$set)) {
        expect(key.startsWith("economic.")).toBe(false);
        expect(key.startsWith("population.")).toBe(false);
      }
    }
  });
});
