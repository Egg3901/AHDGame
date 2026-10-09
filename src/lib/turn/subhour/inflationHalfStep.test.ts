import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { calculateInflationWithBreakdown, type InflationInputs } from "@/lib/budget/inflation";
import {
  advanceHouseholdPriceIndex,
  householdPriceTurnFactor,
} from "@/lib/economy/householdPriceIndex";
import { runInflationRecalc } from "@/lib/turn/inflationRecalc";
import { runInflationHalfStep } from "./inflationHalfStep";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const TURN = 100;

const BASE_INPUTS: InflationInputs = {
  targetInflation: 2,
  neutralPrimeRate: 3,
  unemployment: 4,
  gdpGrowth: 3.5,
  primeRate: 2.5,
  surplusToGdp: -0.03,
  tariffRate: 3,
  wageGrowth: 4,
  commodityPressure: 0.1,
  forexPressure: 0.02,
  savingsPressure: 0.05,
  previousInflation: 3.4,
};

/** One world: the US with a bank, a budget and a national metrics doc. */
function seedWorld(inflationRate: number, householdPriceIndex: number) {
  const memory = createInMemoryDb();
  memory.seed("gameState", [{ _id: "current", currentTurn: TURN - 1, currentYear: 1991 }]);
  memory.seed("centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 1.5,
      nationalSavingsBalance: 1_000_000,
      interestRateHistory: [{ turn: TURN - 1, rate: 1.5 }],
    },
  ]);
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      gdp: 20_000_000_000_000,
      surplus: -800_000_000_000,
      taxRates: { tariffs: 3 },
      economicFactors: { inflationRate, householdPriceIndex, wageGrowth: 5.5 },
    },
  ]);
  memory.seed("macroMetrics", [
    {
      _id: "federal",
      economic: { gdpGrowth: { value: 4.2 }, unemploymentRate: { value: 3.1 } },
    },
  ]);
  return memory;
}

async function budgetOf(memory: ReturnType<typeof createInMemoryDb>) {
  return memory.collection("federalBudget").findOne({ _id: "federal" }) as Promise<{
    economicFactors: { inflationRate: number; householdPriceIndex: number };
    subhourStep?: { turn: number; fraction: number };
    subhourBase?: { inflation?: unknown };
  }>;
}

describe("inflation split math", () => {
  it("leaves the full step byte-identical when no fraction is given", () => {
    const full = calculateInflationWithBreakdown(BASE_INPUTS);
    expect(calculateInflationWithBreakdown({ ...BASE_INPUTS, stepFraction: 1 })).toEqual(full);
    expect(calculateInflationWithBreakdown({ ...BASE_INPUTS, stepFraction: undefined })).toEqual(
      full
    );
  });

  it("composes two halves against one target into one full step (within the 2dp rounding)", () => {
    const full = calculateInflationWithBreakdown(BASE_INPUTS).rate;
    const first = calculateInflationWithBreakdown({ ...BASE_INPUTS, stepFraction: 0.5 }).rate;
    const second = calculateInflationWithBreakdown({
      ...BASE_INPUTS,
      previousInflation: first,
      stepFraction: 0.5,
    }).rate;
    expect(first).not.toBe(BASE_INPUTS.previousInflation);
    expect(first).not.toBe(full);
    expect(Math.abs(second - full)).toBeLessThanOrEqual(0.01);
  });

  it("splits the per-turn limit evenly when it binds", () => {
    const shock = { ...BASE_INPUTS, wageGrowth: 40, previousInflation: 2 };
    const full = calculateInflationWithBreakdown(shock).rate;
    const first = calculateInflationWithBreakdown({ ...shock, stepFraction: 0.5 }).rate;
    const second = calculateInflationWithBreakdown({
      ...shock,
      previousInflation: first,
      stepFraction: 0.5,
    }).rate;
    expect(full).toBe(3.5);
    expect(first).toBe(2.75);
    expect(second).toBe(full);
  });

  it("compounds the household price index by exactly half a turn's exponent", () => {
    const half = householdPriceTurnFactor(6, 0.5);
    expect(half * half).toBeCloseTo(householdPriceTurnFactor(6), 15);
    expect(householdPriceTurnFactor(6, 1)).toBe(householdPriceTurnFactor(6));
    expect(advanceHouseholdPriceIndex(1.2, 6, 1)).toBe(advanceHouseholdPriceIndex(1.2, 6));
  });
});

describe("inflation half step and the turn", () => {
  it("moves the rate and price index at :30, then lands the turn exactly where the no-tick turn lands", async () => {
    const control = seedWorld(3.4, 1.1);
    const ticked = seedWorld(3.4, 1.1);

    await runInflationRecalc(control as unknown as Db, TURN);
    const expected = await budgetOf(control);

    const stats = await runInflationHalfStep(ticked as unknown as Db, TURN, new Date());
    expect(stats.countries).toBe(1);
    const mid = await budgetOf(ticked);
    expect(mid.economicFactors.inflationRate).not.toBe(3.4);
    expect(mid.economicFactors.householdPriceIndex).toBeGreaterThan(1.1);
    expect(mid.subhourStep).toEqual({ turn: TURN, fraction: 0.5 });
    // :30 does not move savings pressure (an hourly chart series).
    const bank = await ticked.collection("centralBanks").findOne({ _id: "US" });
    expect(bank?.currentSavingsPressure).toBeUndefined();

    await runInflationRecalc(ticked as unknown as Db, TURN);
    const landed = await budgetOf(ticked);
    expect(landed.economicFactors.inflationRate).toBe(expected.economicFactors.inflationRate);
    expect(landed.economicFactors.householdPriceIndex).toBe(
      expected.economicFactors.householdPriceIndex
    );
    expect(landed.subhourBase?.inflation).toBeUndefined();
    // The :30 value sits on the way from the start to the turn's value.
    const lo = Math.min(3.4, expected.economicFactors.inflationRate);
    const hi = Math.max(3.4, expected.economicFactors.inflationRate);
    expect(mid.economicFactors.inflationRate).toBeGreaterThanOrEqual(lo);
    expect(mid.economicFactors.inflationRate).toBeLessThanOrEqual(hi);
  });

  it("never applies a half twice when the tick is retried", async () => {
    const memory = seedWorld(3.4, 1.1);
    await runInflationHalfStep(memory as unknown as Db, TURN, new Date());
    const once = await budgetOf(memory);
    const retry = await runInflationHalfStep(memory as unknown as Db, TURN, new Date());
    expect(retry.alreadyStepped).toBe(1);
    expect(await budgetOf(memory)).toEqual(once);
  });

  it("keeps a shock applied between :30 and the turn", async () => {
    const control = seedWorld(3.4, 1.1);
    const ticked = seedWorld(3.4, 1.1);
    await runInflationHalfStep(ticked as unknown as Db, TURN, new Date());
    for (const memory of [control, ticked]) {
      await memory
        .collection("federalBudget")
        .updateOne({ _id: "federal" }, { $inc: { "economicFactors.inflationRate": 1.25 } });
      await runInflationRecalc(memory as unknown as Db, TURN);
    }
    expect((await budgetOf(ticked)).economicFactors.inflationRate).toBe(
      (await budgetOf(control)).economicFactors.inflationRate
    );
  });

  it("ignores a stamp left by an earlier hour", async () => {
    const control = seedWorld(3.4, 1.1);
    const stale = seedWorld(3.4, 1.1);
    await stale.collection("federalBudget").updateOne(
      { _id: "federal" },
      {
        $set: {
          subhourStep: { turn: TURN - 1, fraction: 0.5 },
          "subhourBase.inflation": {
            turn: TURN - 1,
            inflationRate: { base: 9, written: 3.4 },
            householdPriceIndex: { base: 2, written: 1.1 },
          },
        },
      }
    );
    await runInflationRecalc(control as unknown as Db, TURN);
    await runInflationRecalc(stale as unknown as Db, TURN);
    const a = await budgetOf(control);
    const b = await budgetOf(stale);
    expect(b.economicFactors.inflationRate).toBe(a.economicFactors.inflationRate);
    expect(b.economicFactors.householdPriceIndex).toBe(a.economicFactors.householdPriceIndex);
  });
});
