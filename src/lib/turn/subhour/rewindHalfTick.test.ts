import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { rewindHalfTick } from "./rewindHalfTick";

const TURN = 58;
const stamp = { turn: TURN, fraction: 0.5 };

function seed() {
  const memory = createInMemoryDb();
  memory.seed("exchangeRates", [
    {
      _id: "UK",
      rate: 0.81,
      macroTarget: 0.79,
      subhourStep: stamp,
      subhourBase: {
        forex: {
          turn: TURN,
          rate: { base: 0.8, written: 0.81 },
          macroTarget: { base: 0.78, written: 0.79 },
        },
      },
    },
    { _id: "JP", rate: 150 },
  ]);
  memory.seed("federalBudget", [
    {
      _id: "federal",
      economicFactors: { inflationRate: 3.5, householdPriceIndex: 1.02, gdpGrowth: 2.1 },
      subhourStep: stamp,
      subhourBase: {
        inflation: {
          turn: TURN,
          inflationRate: { base: 3, written: 3.5 },
          householdPriceIndex: { base: 1.01, written: 1.02 },
        },
        growth: { turn: TURN, gdpGrowth: { base: 2, written: 2.1 } },
      },
    },
  ]);
  memory.seed("states", [
    {
      _id: "s1",
      // A crisis shock moved GDP by 10% after the :30 write; the rewind keeps it.
      gdp: 1100 * 1.1,
      outputGap: 0.5,
      subhourStep: stamp,
      subhourBase: {
        growth: {
          turn: TURN,
          gdp: { base: 1000, written: 1100 },
          outputGap: { base: 0.2, written: 0.4 },
        },
      },
    },
  ]);
  memory.seed("macroMetrics", [
    {
      _id: "s1",
      economic: { gdpGrowth: { value: 2.4 } },
      subhourStep: stamp,
      subhourBase: { growth: { turn: TURN, gdpGrowth: { base: 2.2, written: 2.4 } } },
    },
    // A national doc stamped without a start value: only the stamp is cleared.
    { _id: "federal", economic: { gdpGrowth: { value: 9 } }, subhourStep: stamp },
  ]);
  return memory;
}

describe("rewindHalfTick", () => {
  it("restores every stamped value to the start of the hour and clears the stamps", async () => {
    const memory = seed();
    const result = await rewindHalfTick(memory as unknown as Db, TURN);
    expect(result.rewound).toMatchObject({
      exchangeRates: 1,
      federalBudget: 1,
      states: 1,
      macroMetrics: 2,
    });

    const uk = await memory.collection("exchangeRates").findOne({ _id: "UK" });
    expect(uk).toMatchObject({ rate: 0.8, macroTarget: 0.78 });
    expect(uk?.subhourStep).toBeUndefined();
    expect(uk?.subhourBase).toBeUndefined();
    expect(await memory.collection("exchangeRates").findOne({ _id: "JP" })).toEqual({
      _id: "JP",
      rate: 150,
    });

    const budget = await memory.collection("federalBudget").findOne({ _id: "federal" });
    expect(budget?.economicFactors).toEqual({
      inflationRate: 3,
      householdPriceIndex: 1.01,
      gdpGrowth: 2,
    });

    const s1 = await memory.collection("states").findOne({ _id: "s1" });
    // Offset kept: (1100 * 1.1) * (1000 / 1100) and 0.5 - (0.4 - 0.2).
    expect(s1?.gdp).toBeCloseTo(1100, 9);
    expect(s1?.outputGap).toBeCloseTo(0.3, 12);

    const m = await memory.collection("macroMetrics").findOne({ _id: "s1" });
    expect(m?.economic).toEqual({ gdpGrowth: { value: 2.2 } });
    const national = await memory.collection("macroMetrics").findOne({ _id: "federal" });
    expect(national).toEqual({ _id: "federal", economic: { gdpGrowth: { value: 9 } } });
  });

  it("is a no-op when run again (a retried turn)", async () => {
    const memory = seed();
    await rewindHalfTick(memory as unknown as Db, TURN);
    const once = await memory.collection("states").find({}).toArray();
    const again = await rewindHalfTick(memory as unknown as Db, TURN);
    expect(Object.values(again.rewound).every((n) => n === 0)).toBe(true);
    expect(await memory.collection("states").find({}).toArray()).toEqual(once);
  });
});
