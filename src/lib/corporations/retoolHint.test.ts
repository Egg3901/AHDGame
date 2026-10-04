import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import type { SectorStrategy } from "@/lib/constants/sectorStrategies";
import { computeRetoolHint, RETOOL_HINT_SUSTAIN_FILL, type RetoolHintInput } from "./retoolHint";

const strategy = (id: string, supply: Partial<Record<CommodityType, number>>): SectorStrategy => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  description: "",
  supply,
  demand: {},
});

const SOFTWARE = strategy("software", { software: 0.55, electronics: 0.15 });
const HARDWARE = strategy("hardware", { electronics: 0.55, software: 0.15 });
const STANDARD = strategy("standard", { electronics: 0.35, software: 0.35 });

/** A US technology plant on the software strategy, ticket 1370's MA plant. */
function input(over: Partial<RetoolHintInput> = {}): RetoolHintInput {
  const books: Partial<Record<CommodityType, { supply: number; demand: number }>> = {
    // Software oversupplied 1.5x, electronics 31% short (live US t1266 shape).
    software: { supply: 3_800_000, demand: 2_500_000 },
    electronics: { supply: 14_500_000, demand: 21_000_000 },
  };
  const prices: Partial<Record<CommodityType, number>> = { software: 2.2, electronics: 7.2 };
  return {
    currentStrategyId: "software",
    currentSupply: SOFTWARE.supply,
    soldByCommodity: { software: 0.3, electronics: 1 },
    demandThrottleFactor: 0.1,
    mothballed: false,
    isTransitioning: false,
    producedUnits: 24_000,
    capacityUnits: 212_000,
    strategies: [STANDARD, HARDWARE, SOFTWARE],
    isAvailable: () => true,
    rescaleRatio: () => 1,
    priceRatioFor: (c) => prices[c],
    balanceFor: (c) => books[c],
    basePrices: COMMODITY_BASE_PRICES,
    ...over,
  };
}

describe("computeRetoolHint", () => {
  it("names the strategy that sells when the plant's valuable output is the glutted one", () => {
    const hint = computeRetoolHint(input());
    expect(hint).not.toBeNull();
    expect(hint!.currentMain.commodity).toBe("software");
    expect(hint!.currentMain.fill).toBeCloseTo(0.3, 6);
    expect(hint!.currentValueFill).toBeLessThan(RETOOL_HINT_SUSTAIN_FILL);
    expect(hint!.suggestedStrategyId).toBe("hardware");
    expect(hint!.suggestedMain.commodity).toBe("electronics");
    expect(hint!.suggestedMain.unmetShare).toBeCloseTo(1 - 14_500_000 / 21_000_000, 6);
    expect(hint!.suggestedValueFill).toBeGreaterThanOrEqual(RETOOL_HINT_SUSTAIN_FILL);
  });

  it("stays quiet for a plant that is not held back, or is already climbing", () => {
    expect(computeRetoolHint(input({ demandThrottleFactor: 1 }))).toBeNull();
    expect(computeRetoolHint(input({ demandThrottleFactor: null }))).toBeNull();
    // Sells nearly all of its output value: the throttle is already ramping it.
    expect(
      computeRetoolHint(input({ soldByCommodity: { software: 0.97, electronics: 1 } }))
    ).toBeNull();
  });

  it("stays quiet for a mothballed plant or one already retooling", () => {
    expect(computeRetoolHint(input({ mothballed: true }))).toBeNull();
    expect(computeRetoolHint(input({ isTransitioning: true }))).toBeNull();
  });

  it("does not suggest a locked strategy", () => {
    // Hardware locked: Standard is half software by rate but three quarters
    // electronics by value at these prices, so it is the next best and clears.
    const hint = computeRetoolHint(input({ isAvailable: (s) => s.id !== "hardware" }));
    expect(hint?.suggestedStrategyId).toBe("standard");
    expect(computeRetoolHint(input({ isAvailable: () => false }))).toBeNull();
  });

  it("does not suggest a mix the plant's own output would flood", () => {
    // A plant big enough to wipe out the electronics shortage on its own.
    const hint = computeRetoolHint(input({ capacityUnits: 40_000_000, producedUnits: 4_000_000 }));
    expect(hint).toBeNull();
  });

  it("stays quiet when every market this sector can serve is oversupplied", () => {
    const hint = computeRetoolHint(
      input({
        balanceFor: (c) =>
          c === "software"
            ? { supply: 3_800_000, demand: 2_500_000 }
            : { supply: 30_000_000, demand: 21_000_000 },
      })
    );
    expect(hint).toBeNull();
  });
});
