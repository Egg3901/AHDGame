import { describe, it, expect, vi } from "vitest";
import {
  computeNppChairRateTarget,
  computeNppChairRateStep,
  processNppChairAutoRate,
} from "../nppChairAutoRate";

describe("computeNppChairRateTarget", () => {
  it("hikes above neutral when inflation is hot", () => {
    const target = computeNppChairRateTarget({
      neutralRate: 4.0,
      inflationRate: 5.0,
      targetInflation: 2.0,
      gdpGrowth: 2.0,
    });
    // 4.0 + 1.0*(5-2) + 0.5*(2-2) = 7.0
    expect(target).toBeCloseTo(7.0, 6);
  });

  it("cuts below neutral when growth is below target", () => {
    const target = computeNppChairRateTarget({
      neutralRate: 4.0,
      inflationRate: 2.0,
      targetInflation: 2.0,
      gdpGrowth: -1.0,
    });
    // 4.0 + 0 + 0.5*(-1-2) = 2.5
    expect(target).toBeCloseTo(2.5, 6);
  });

  it("stagflation resolves by the larger gap", () => {
    const target = computeNppChairRateTarget({
      neutralRate: 4.0,
      inflationRate: 4.0, // +2.0 inflation term (gap 4-2 = 2)
      targetInflation: 2.0,
      gdpGrowth: 0.0, // -1.0 growth term
    });
    // 4.0 + 2.0 - 1.0 = 5.0 (net hike because inflation gap dominates)
    expect(target).toBeCloseTo(5.0, 6);
  });
});

describe("computeNppChairRateStep", () => {
  it("moves a fraction of the gap, clamped to hike cap", () => {
    // gap = 10 - 2 = 8; 0.5*8 = 4 -> clamp to +0.75
    expect(computeNppChairRateStep({ currentRate: 2.0, targetRate: 10.0 })).toBeCloseTo(0.75, 6);
  });

  it("clamps to the cut cap", () => {
    // gap = 2 - 10 = -8; 0.5*-8 = -4 -> clamp to -1.75
    expect(computeNppChairRateStep({ currentRate: 10.0, targetRate: 2.0 })).toBeCloseTo(-1.75, 6);
  });

  it("returns ~0 when already at target", () => {
    expect(computeNppChairRateStep({ currentRate: 4.0, targetRate: 4.0 })).toBeCloseTo(0, 6);
  });
});

function mockRateDb(budget: any, nationalMetrics: any) {
  const updateOne = vi.fn(async () => ({ matchedCount: 1 }));
  const db = {
    collection: (name: string) => ({
      updateOne,
      findOne: async (_q: any) => {
        if (name === "federalBudget") return budget;
        if (name === "stateMetrics") return nationalMetrics;
        return null;
      },
    }),
  } as any;
  return { db, updateOne };
}

describe("processNppChairAutoRate", () => {
  it("hikes primeRate when inflation hot and writes lastRateChangeTurn", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 5.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    // US defaultPrimeRate = 3.0 -> target = 3.0 + 1.0*(5-2) + 0 = 6.0; step = 0.5*(6-4) = 1.0 -> +0.75
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: null,
      chairMode: "npp",
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50);
    expect(updateOne).toHaveBeenCalled();
    const callArgs = updateOne.mock.calls[0] as unknown as [
      unknown,
      { $set: { primeRate: number; lastRateChangeTurn: number } },
    ];
    const op = callArgs[1];
    expect(op.$set.primeRate).toBeGreaterThan(4.0);
    expect(op.$set.lastRateChangeTurn).toBe(50);
  });

  it("is a no-op within the cooldown window", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 9.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: 48, // 50-48 = 2 < 6
      chairMode: "npp",
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("is a no-op when step is ~0", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 2.0 } }, // at target
      { economic: { gdpGrowth: { value: 2.0 } } } // at target
    );
    // US defaultPrimeRate = 3.0 -> target = 3.0; primeRate 3.0 -> step 0
    const bank = {
      _id: "b" as any,
      primeRate: 3.0,
      lastRateChangeTurn: null,
      chairMode: "npp",
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("is a no-op when chairMode !== 'npp'", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 9.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: null,
      chairMode: "character",
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it("is a no-op when chairMode is unset", async () => {
    const { db, updateOne } = mockRateDb(
      { economicFactors: { inflationRate: 9.0 } },
      { economic: { gdpGrowth: { value: 2.0 } } }
    );
    const bank = {
      _id: "b" as any,
      primeRate: 4.0,
      lastRateChangeTurn: null,
    } as any;
    await processNppChairAutoRate(db, bank, "US" as any, 50);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
