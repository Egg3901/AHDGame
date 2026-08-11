import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// Mock the sector-revenue provider so the phase test controls the sector mix.
vi.mock("@/lib/metricEngine/providers", () => ({
  sectorRevenueTaxProvider: vi.fn(),
}));

describe("processEconomicModelTurn", () => {
  let db: MockDb;

  function setup<T>(name: string, data: T[]) {
    db.collection(name);
    db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
      toArray: vi.fn().mockResolvedValue(data),
    });
    db.collectionMocks[name]!.bulkWrite = vi.fn().mockResolvedValue({ modifiedCount: data.length });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    // US with two defense-heavy regions.
    setup("states", [
      { _id: "us1", countryId: "US" },
      { _id: "us2", countryId: "US" },
    ]);
    setup("macroMetrics", []); // no prior models → cold start
    setup("enactedLaws", []);
    setup("federalBudget", [
      {
        _id: "federal",
        countryId: "US",
        spending: { byCategory: { defense: 800, education: 200 } },
      },
    ]);
    setup("stateBudgets", [
      { _id: "us1", spending: { byCategory: { defense: 80, education: 20 } } },
      { _id: "us2", spending: { byCategory: { defense: 80, education: 20 } } },
    ]);
    setup("corporations", []); // no state ownership by default
    setup("corporateSectors", []);

    const { sectorRevenueTaxProvider } = await import("@/lib/metricEngine/providers");
    vi.mocked(sectorRevenueTaxProvider).mockResolvedValue({
      ownedByState: new Map([
        ["us1", [{ revenue: 70, currentGrowthRate: 2, sectorType: "defense" }]],
        ["us2", [{ revenue: 50, currentGrowthRate: 2, sectorType: "defense" }]],
      ]),
      unownedByState: new Map([
        ["us1", [{ revenue: 30, sectorType: "retail" }]],
        ["us2", [{ revenue: 50, sectorType: "retail" }]],
      ]),
      federalSalesTaxByCountry: new Map(),
      stateSalesTaxByState: new Map(),
    } as unknown as Awaited<ReturnType<typeof sectorRevenueTaxProvider>>);
  });

  it("cold-starts the US national doc to its 1991 seed model (militaryIndustrial) with positive intensity", async () => {
    const { processEconomicModelTurn } = await import("./economicModelTurn");
    const out = await processEconomicModelTurn(1, 1991); // 1991 era → US seeds militaryIndustrial

    expect(out.countriesProcessed).toBe(1);
    // National-only: regions are not classified or written.
    expect(out.regionsProcessed).toBe(0);

    const ops = db.collectionMocks.macroMetrics!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: {
        filter: { _id: string };
        update: {
          $set: {
            economicModel: { current: string; intensity: number; scores: Record<string, number> };
          };
        };
      };
    }>;
    const national = ops.find((o) => o.updateOne.filter._id === "federal")!.updateOne.update.$set
      .economicModel;
    expect(national.current).toBe("militaryIndustrial"); // US seed
    expect(national.intensity).toBeGreaterThan(0);
    // Economic models are national only — no per-region doc is written.
    expect(ops.some((o) => o.updateOne.filter._id === "us1")).toBe(false);
    expect(ops.every((o) => o.updateOne.filter._id === "federal")).toBe(true);
  });

  it("uses the 2019 seed model (techInnovation) for a 2019-era start", async () => {
    const { processEconomicModelTurn } = await import("./economicModelTurn");
    await processEconomicModelTurn(1, 2019); // 2019 era → US seeds techInnovation

    const ops = db.collectionMocks.macroMetrics!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: {
        filter: { _id: string };
        update: { $set: { economicModel: { current: string } } };
      };
    }>;
    const national = ops.find((o) => o.updateOne.filter._id === "federal")!.updateOne.update.$set
      .economicModel;
    expect(national.current).toBe("techInnovation");
  });

  it("national sector revenue is the SUM of the regions (SSOT) — defense leads the score", async () => {
    const { processEconomicModelTurn } = await import("./economicModelTurn");
    await processEconomicModelTurn(1);
    const ops = db.collectionMocks.macroMetrics!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: {
        filter: { _id: string };
        update: { $set: { economicModel: { scores: Record<string, number> } } };
      };
    }>;
    const national = ops.find((o) => o.updateOne.filter._id === "federal")!.updateOne.update.$set
      .economicModel;
    // total defense 120 / total 200 → strong militaryIndustrial score, above the others.
    expect(national.scores.militaryIndustrial).toBeGreaterThan(national.scores.techInnovation);
    expect(national.scores.militaryIndustrial).toBeGreaterThan(national.scores.agrarian);
  });

  it("computes the state-ownership lever — NatCorp-owned sectors drive the State-Capitalist score", async () => {
    // Re-mock corporations + corporateSectors so a National Corp owns all 3 US sectors.
    const override = <T>(name: string, data: T[]) => {
      db.collectionMocks[name]!.find = vi.fn().mockReturnValue({
        project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(data) }),
        toArray: vi.fn().mockResolvedValue(data),
      });
    };
    override("corporations", [{ _id: "natco", countryOwnerId: "US" }]); // a National Corporation
    // 6 NatCorp-owned corporate sectors + the 2 unowned (from the provider mock) =
    // 8 total → 6/8 = 75% ≥ 67% (unowned counts in the denominator).
    override("corporateSectors", [
      { _id: "s1", corporationId: "natco", countryId: "US", stateId: "us1" },
      { _id: "s2", corporationId: "natco", countryId: "US", stateId: "us1" },
      { _id: "s3", corporationId: "natco", countryId: "US", stateId: "us1" },
      { _id: "s4", corporationId: "natco", countryId: "US", stateId: "us2" },
      { _id: "s5", corporationId: "natco", countryId: "US", stateId: "us2" },
      { _id: "s6", corporationId: "natco", countryId: "US", stateId: "us2" },
    ]);

    const { processEconomicModelTurn } = await import("./economicModelTurn");
    await processEconomicModelTurn(1);
    const ops = db.collectionMocks.macroMetrics!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: {
        filter: { _id: string };
        update: { $set: { economicModel: { scores: Record<string, number> } } };
      };
    }>;
    const national = ops.find((o) => o.updateOne.filter._id === "federal")!.updateOne.update.$set
      .economicModel;
    // 3/3 sectors state-owned ≥ 67% → State-Capitalist affinity = share (1.0) → score ~100,
    // above the defense-driven militaryIndustrial. (Cold-start `current` still honors the
    // US seed; the lever drives the SCORE that flips it via hysteresis over time.)
    expect(national.scores.stateCapitalist).toBeGreaterThan(67);
    expect(national.scores.stateCapitalist).toBeGreaterThan(national.scores.militaryIndustrial);
  });
});
