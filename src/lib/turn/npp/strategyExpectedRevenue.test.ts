import { describe, expect, it } from "vitest";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import {
  CHRONIC_LOW_FILL_THRESHOLD,
  decideExtractionStrategySwitch,
  primaryExtractionResource,
  scoreStrategyExpectedRevenue,
  STRATEGY_SWITCH_MIN_IMPROVEMENT,
} from "./strategyExpectedRevenue";

const EXTRACTION = SECTOR_STRATEGIES.extraction;

const neutralPrices = () => 1;
const uncapped = () => 1;

describe("scoreStrategyExpectedRevenue", () => {
  it("sums rate × price ratio × headroom over outputs", () => {
    const score = scoreStrategyExpectedRevenue(
      { iron: 0.5, rare_earth: 0.2 },
      (c) => (c === "iron" ? 2 : 1),
      (r) => (r === "iron" ? 0.5 : 1)
    );
    // iron: 0.5 × 2 × 0.5 = 0.5; rare_earth: 0.2 × 1 × 1 = 0.2
    expect(score).toBeCloseTo(0.7);
  });

  it("treats unpriced commodities as neutral (ratio 1)", () => {
    const score = scoreStrategyExpectedRevenue({ iron: 0.4 }, () => null, uncapped);
    expect(score).toBeCloseTo(0.4);
  });

  it("zero state headroom kills the score for that resource", () => {
    const score = scoreStrategyExpectedRevenue(
      { iron: 0.78 },
      () => 5, // huge global price signal…
      () => 0 // …but the state can't extract any of it
    );
    expect(score).toBe(0);
  });
});

describe("primaryExtractionResource", () => {
  it("returns the highest-rate extractable output", () => {
    expect(primaryExtractionResource({ id: "x", supply: { oil: 0.58, natural_gas: 0.32 } })).toBe(
      "oil"
    );
  });

  it("returns null when nothing extractable is produced", () => {
    expect(primaryExtractionResource({ id: "x", supply: {} })).toBeNull();
  });
});

describe("decideExtractionStrategySwitch", () => {
  it("stays put when the current strategy is already (near) best", () => {
    // Iron premium: iron_mining scores 0.78 × 1.5 = 1.17; the diversified
    // "standard" (Σ rates ≈ 1.01, iron leg boosted → ≈ 1.135) is close but
    // does not clear the 25% switch margin.
    const decision = decideExtractionStrategySwitch({
      currentStrategyId: "iron_mining",
      strategies: EXTRACTION,
      priceRatioOf: (c) => (c === "iron" ? 1.5 : 1),
      headroomOf: uncapped,
    });
    expect(decision).toBeNull();
  });

  it("requires the best candidate to beat the current by the switch margin", () => {
    const strategies = [
      { id: "a", supply: { iron: 0.5 } },
      { id: "b", supply: { rare_earth: 0.5 * (1 + STRATEGY_SWITCH_MIN_IMPROVEMENT) } }, // exactly at margin
    ] as const;
    expect(
      decideExtractionStrategySwitch({
        currentStrategyId: "a",
        strategies,
        priceRatioOf: neutralPrices,
        headroomOf: uncapped,
      })
    ).toBeNull();

    const clearlyBetter = [
      { id: "a", supply: { iron: 0.5 } },
      { id: "b", supply: { rare_earth: 0.8 } }, // +60%
    ] as const;
    const decision = decideExtractionStrategySwitch({
      currentStrategyId: "a",
      strategies: clearlyBetter,
      priceRatioOf: neutralPrices,
      headroomOf: uncapped,
    });
    expect(decision?.strategyId).toBe("b");
  });

  it("switches OUT of a strategy whose deposit the state cannot support (t899 bug)", () => {
    // NPP miner focused on iron in a state with ~zero iron capacity while a
    // large rare_earth deposit idles.
    const decision = decideExtractionStrategySwitch({
      currentStrategyId: "iron_mining",
      strategies: EXTRACTION,
      priceRatioOf: neutralPrices,
      headroomOf: (r) => (r === "iron" ? 0 : r === "rare_earth" ? 1 : 0.1),
    });
    expect(decision).not.toBeNull();
    expect(decision!.strategyId).toBe("rare_earth_mining");
    expect(decision!.currentScore).toBe(0);
  });

  it("never switches INTO a strategy whose primary resource has ~zero headroom", () => {
    const strategies = [
      { id: "a", supply: { rare_earth: 0.3 } },
      { id: "b", supply: { iron: 0.9 } }, // best on paper…
    ] as const;
    const decision = decideExtractionStrategySwitch({
      currentStrategyId: "a",
      strategies,
      priceRatioOf: () => 3, // iron price screaming
      headroomOf: (r) => (r === "iron" ? 0.01 : 1), // …but no local iron headroom
    });
    expect(decision).toBeNull();
  });

  it("weights the decision by lagged price ratios", () => {
    // rare_earth at 2× base beats iron at 0.6× base even at similar rates.
    const decision = decideExtractionStrategySwitch({
      currentStrategyId: "iron_mining",
      strategies: EXTRACTION,
      priceRatioOf: (c) => (c === "rare_earth" ? 2 : c === "iron" ? 0.6 : 1),
      headroomOf: uncapped,
    });
    expect(decision?.strategyId).toBe("rare_earth_mining");
  });

  it("relaxes the switch margin under chronic low fill", () => {
    const strategies = [
      { id: "a", supply: { iron: 0.5 } },
      { id: "b", supply: { rare_earth: 0.58 } }, // +16%: below 25%, above 10%
    ] as const;
    const base = {
      currentStrategyId: "a",
      strategies,
      priceRatioOf: neutralPrices,
      headroomOf: uncapped,
    };
    expect(decideExtractionStrategySwitch({ ...base, soldFraction: 0.9 })).toBeNull();
    const decision = decideExtractionStrategySwitch({
      ...base,
      soldFraction: CHRONIC_LOW_FILL_THRESHOLD - 0.05,
    });
    expect(decision?.strategyId).toBe("b");
  });

  it("treats an unknown current strategy id as yielding nothing", () => {
    const decision = decideExtractionStrategySwitch({
      currentStrategyId: "legacy_ghost",
      strategies: EXTRACTION,
      priceRatioOf: neutralPrices,
      headroomOf: uncapped,
    });
    expect(decision).not.toBeNull();
    expect(decision!.currentScore).toBe(0);
  });
});

describe("generic (non-extraction) strategy switching — the fertilizer valve", () => {
  it("a chemicals sector on standard switches to fertilizers under the observed squeeze", () => {
    // Prod shape, 2026-08-16: fertilizers 2.33x base, chemicals 0.83x. The
    // decider must move a standard industrial-chemicals NPP sector onto the
    // fertilizers strategy; headroom is 1 for every non-extractable.
    const strategies = [
      { id: "standard", supply: { chemicals: 0.5 } },
      { id: "fertilizers", supply: { fertilizers: 0.5, chemicals: 0.1 } },
      { id: "pharmaceuticals", supply: { pharmaceuticals: 0.45, chemicals: 0.1 } },
    ];
    const ratios: Record<string, number> = {
      chemicals: 0.83,
      fertilizers: 2.33,
      pharmaceuticals: 0.9,
    };
    const decision = decideExtractionStrategySwitch({
      currentStrategyId: "standard",
      strategies,
      priceRatioOf: (c) => ratios[c] ?? null,
      headroomOf: () => 1,
      soldFraction: 1,
    });
    expect(decision?.strategyId).toBe("fertilizers");
    expect(decision!.bestScore).toBeGreaterThan(decision!.currentScore * 1.2);
  });

  it("does not churn when the current strategy already leads", () => {
    const strategies = [
      { id: "standard", supply: { chemicals: 0.5 } },
      { id: "fertilizers", supply: { fertilizers: 0.5, chemicals: 0.1 } },
    ];
    const decision = decideExtractionStrategySwitch({
      currentStrategyId: "fertilizers",
      strategies,
      priceRatioOf: (c) => (c === "fertilizers" ? 2.33 : 0.83),
      headroomOf: () => 1,
      soldFraction: 1,
    });
    expect(decision).toBeNull();
  });
});
