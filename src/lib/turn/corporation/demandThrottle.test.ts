import { describe, expect, it } from "vitest";
import {
  DEMAND_PROBE_MARGIN,
  DEMAND_THROTTLE_FLOOR,
  demandThrottleFactor,
  soldOutMarketHeadroomUnits,
  throttleSoldUnits,
  withLatentDemand,
} from "./demandThrottle";

describe("demandThrottleFactor — flip identity", () => {
  it("does not throttle a plant running at capacity and clearing it", () => {
    // Target 1,150 exceeds the 1,000 it can physically make, so nothing moves.
    expect(demandThrottleFactor(1_000, 1_000, 1_000)).toBe(1);
  });

  it("still ramps a plant that cleared a REDUCED run, rather than restoring it in full", () => {
    // Restoring full capacity the moment a throttled plant sells out is exactly
    // the oscillation this design avoids: it would glut again next turn.
    const factor = demandThrottleFactor(1_000, 800, 800);
    expect(factor).toBeLessThan(1);
    expect(factor * 1_000).toBeCloseTo(800 * (1 + DEMAND_PROBE_MARGIN), 6);
  });

  it("does not throttle a sector with no production history", () => {
    // Newly founded, or a world that has never run the clearing pre-pass.
    expect(demandThrottleFactor(1_000, null, null)).toBe(1);
    expect(demandThrottleFactor(1_000, 0, 0)).toBe(1);
    expect(demandThrottleFactor(1_000, 500, undefined)).toBe(1);
  });

  it("does not throttle when last turn's sales already cover this turn's plan", () => {
    // Sold 950 of 1,000, so the probe target is 1,092.5 — above the 1,000
    // planned, and a near-clearing plant should not be penalised.
    expect(demandThrottleFactor(1_000, 950, 1_000)).toBe(1);
  });

  it("returns 1 for a plant that is producing nothing anyway", () => {
    expect(demandThrottleFactor(0, 10, 1_000)).toBe(1);
    expect(demandThrottleFactor(Number.NaN, 10, 1_000)).toBe(1);
  });

  it("ignores a non-finite sales figure rather than throttling on garbage", () => {
    expect(demandThrottleFactor(1_000, Number.NaN, 1_000)).toBe(1);
  });
});

describe("demandThrottleFactor — glut", () => {
  it("targets last turn's sales plus the probe margin", () => {
    // The reported shape: 60k made, 10k sold.
    const factor = demandThrottleFactor(60_000, 10_000, 60_000);
    expect(factor * 60_000).toBeCloseTo(10_000 * (1 + DEMAND_PROBE_MARGIN), 6);
  });

  it("cuts cost roughly in proportion, which is the whole point", () => {
    // Inputs bill at producedUnits; revenue books at soldUnits. Bringing
    // production down to what sells is what closes the -254% margin.
    const factor = demandThrottleFactor(60_000, 10_000, 60_000);
    expect(factor).toBeLessThan(0.2);
    expect(factor).toBeGreaterThan(DEMAND_THROTTLE_FLOOR);
  });

  it("never idles a plant completely, even after selling nothing", () => {
    // Zero output means zero presence on the clearing book, which would make
    // "sold nothing" permanent and self-fulfilling. Mothball is the deliberate
    // way to stop, and it zeroes production upstream of this.
    expect(demandThrottleFactor(60_000, 0, 60_000)).toBe(DEMAND_THROTTLE_FLOOR);
  });

  it("stays within [floor, 1] across the whole range of sales", () => {
    for (const sold of [0, 1, 100, 5_000, 30_000, 59_999, 60_000]) {
      const f = demandThrottleFactor(60_000, sold, 60_000);
      expect(f).toBeGreaterThanOrEqual(DEMAND_THROTTLE_FLOOR);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe("demandThrottleFactor — convergence", () => {
  it("ramps back up while the market absorbs the extra, instead of oscillating", () => {
    // A fraction-based throttle oscillates: cut to what sold, sell all of it,
    // read soldFraction 1.0, produce full, glut again. Targeting absolute sold
    // units converges upward instead.
    const capacity = 60_000;
    let produced = capacity;
    let sold = 10_000;
    const path: number[] = [];
    for (let turn = 0; turn < 5; turn++) {
      const next = capacity * demandThrottleFactor(capacity, sold, produced);
      path.push(next);
      produced = next;
      sold = next; // the market takes everything offered
    }
    // Strictly increasing, and never back to a 60k glut.
    for (let i = 1; i < path.length; i++) expect(path[i]).toBeGreaterThan(path[i - 1]);
    expect(path[path.length - 1]).toBeLessThan(capacity);
    expect(path[0]).toBeCloseTo(11_500, 6);
  });

  it("settles when the market stops absorbing more", () => {
    const capacity = 60_000;
    // Offered 11,500, sold only 10,000 again: the target is unchanged, so the
    // plan settles rather than ratcheting down.
    const first = capacity * demandThrottleFactor(capacity, 10_000, capacity);
    const second = capacity * demandThrottleFactor(capacity, 10_000, first);
    expect(second).toBeCloseTo(first, 6);
  });
});

describe("throttleSoldUnits (ticket 1370: mixed-output plants)", () => {
  // Hardware plant: electronics 0.55, software 0.15. Electronics sold out into a
  // shortage priced at 8x base, software sold a tenth into a glut at 2x.
  const hardware = { electronics: 0.55, software: 0.15 };
  const prices: Record<string, number> = { electronics: 8, software: 2 };

  it("returns soldUnits untouched for a single-output sector", () => {
    expect(
      throttleSoldUnits({
        producedUnits: 1_000,
        soldUnits: 600,
        soldByCommodity: { energy: 0.6 },
        supplyRates: { energy: 0.65 },
        priceRatioFor: () => 3,
      })
    ).toBe(600);
  });

  it("values each leg at its market price, so a sold-out shortage good lets the plant ramp", () => {
    // Rate-blended sales read 0.806 and kept the plant shrinking (0.806 x 1.15 < 1).
    const blended = 1_000 * ((0.55 * 1 + 0.15 * 0.1) / 0.7);
    const sold = throttleSoldUnits({
      producedUnits: 1_000,
      soldUnits: blended,
      soldByCommodity: { electronics: 1, software: 0.1 },
      supplyRates: hardware,
      priceRatioFor: (c) => prices[c],
    })!;
    const weightE = 0.55 * 8;
    const weightS = 0.15 * 2;
    expect(sold).toBeCloseTo((1_000 * (weightE + weightS * 0.1)) / (weightE + weightS), 6);
    expect(blended * (1 + DEMAND_PROBE_MARGIN)).toBeLessThan(1_000);
    expect(sold * (1 + DEMAND_PROBE_MARGIN)).toBeGreaterThan(1_000);
    // A plant held to the floor by the blend climbs off it.
    expect(demandThrottleFactor(10_000, sold, 1_000)).toBeGreaterThan(DEMAND_THROTTLE_FLOOR);
  });

  it("still throttles a plant whose valuable output is the glutted leg", () => {
    // Software strategy: software 0.55 in a glut, electronics 0.15 sells out.
    // Most of what it makes has no buyer, so the guard must still hold.
    const sold = throttleSoldUnits({
      producedUnits: 1_000,
      soldUnits: 400,
      soldByCommodity: { electronics: 1, software: 0.2 },
      supplyRates: { software: 0.55, electronics: 0.15 },
      priceRatioFor: () => 2,
    })!;
    expect(sold * (1 + DEMAND_PROBE_MARGIN)).toBeLessThan(1_000);
  });

  it("falls back to soldUnits when per-leg fills or production are missing", () => {
    const base = { soldUnits: 500, supplyRates: hardware, priceRatioFor: () => 1 };
    expect(throttleSoldUnits({ ...base, producedUnits: 1_000, soldByCommodity: null })).toBe(500);
    expect(
      throttleSoldUnits({ ...base, producedUnits: 0, soldByCommodity: { electronics: 1 } })
    ).toBe(500);
    // Only one leg has a recorded fill: not enough to restate the blend.
    expect(
      throttleSoldUnits({ ...base, producedUnits: 1_000, soldByCommodity: { electronics: 1 } })
    ).toBe(500);
  });

  it("treats a missing or invalid price as base, never as zero weight", () => {
    const sold = throttleSoldUnits({
      producedUnits: 1_000,
      soldUnits: 0,
      soldByCommodity: { electronics: 1, software: 0 },
      supplyRates: hardware,
      priceRatioFor: (c) => (c === "electronics" ? Number.NaN : undefined),
    })!;
    expect(sold).toBeCloseTo((1_000 * 0.55) / 0.7, 6);
  });
});

describe("sold-out plants in a short market (ticket 1393)", () => {
  // Mixed manufacturing plant: two legs sold out into short books, one into a
  // balanced book. Mix weights stand in for clearing's rate/base split.
  const supplyRates = { electronics: 0.4, building_materials: 0.3, steel: 0.3 };
  const mixWeights: Record<string, number> = {
    electronics: 0.3,
    building_materials: 0.3,
    steel: 0.4,
  };
  const balances: Record<string, { supply: number; demand: number }> = {
    electronics: { supply: 6_479, demand: 11_198 },
    building_materials: { supply: 4_767, demand: 5_985 },
    steel: { supply: 2_672, demand: 2_594 },
  };
  const base = {
    supplyRates,
    mixWeightFor: (c: string) => mixWeights[c] ?? 0,
    balanceFor: (c: string) => balances[c],
    priceRatioFor: () => 1,
  };

  it("lets a plant that sold out into unmet demand run at capacity", () => {
    const headroom = soldOutMarketHeadroomUnits({
      ...base,
      soldByCommodity: { electronics: 1, building_materials: 1, steel: 1 },
    });
    expect(headroom).toBeGreaterThan(1_000);
    // The reported case: 336 sold of ~1,000 capacity, all of it.
    expect(demandThrottleFactor(990, 336, 336, null, headroom)).toBe(1);
  });

  it("ignores legs that did not sell out", () => {
    const headroom = soldOutMarketHeadroomUnits({
      ...base,
      soldByCommodity: { electronics: 0.9, building_materials: 0.9, steel: 1 },
    });
    expect(headroom).toBe(0);
    const factor = demandThrottleFactor(990, 336, 336, null, headroom);
    expect(factor * 990).toBeCloseTo(336 * (1 + DEMAND_PROBE_MARGIN), 6);
  });

  it("weights short legs by value so a glutted co-product dilutes the step", () => {
    const glutted = {
      ...base,
      balanceFor: (c: string) =>
        c === "electronics" ? balances.electronics : { supply: 10_000, demand: 5_000 },
    };
    const headroom = soldOutMarketHeadroomUnits({
      ...glutted,
      soldByCommodity: { electronics: 1, building_materials: 1, steel: 1 },
    });
    // Only the electronics leg (40% of value) carries unmet demand.
    expect(headroom).toBeCloseTo(0.4 * ((11_198 - 6_479) / 0.3), 6);
  });

  it("adds nothing without per-leg sales history", () => {
    expect(soldOutMarketHeadroomUnits({ ...base, soldByCommodity: null })).toBe(0);
  });

  it("keeps the glut throttle unchanged when headroom is absent", () => {
    expect(demandThrottleFactor(1_000, 200, 1_000, null, 0)).toBe(
      demandThrottleFactor(1_000, 200, 1_000)
    );
  });
});

describe("withLatentDemand", () => {
  it("restores truncated demand pro rata so a sold-out plant sees the real gap", () => {
    // Ledger capped demand at 1.5x supply and parked a further 50% as truncated.
    const capped = { supply: 100, demand: 150 };
    expect(withLatentDemand(capped, 1.5)).toEqual({ supply: 100, demand: 225 });
    const headroom = soldOutMarketHeadroomUnits({
      soldByCommodity: { food: 1 },
      supplyRates: { food: 1 },
      mixWeightFor: () => 1,
      balanceFor: () => withLatentDemand(capped, 1.5),
      priceRatioFor: () => 2,
    });
    expect(headroom).toBe(125);
  });

  it("returns the balance unchanged without a lifting factor", () => {
    const b = { supply: 100, demand: 120 };
    expect(withLatentDemand(b, undefined)).toBe(b);
    expect(withLatentDemand(b, 1)).toBe(b);
    expect(withLatentDemand(b, Number.NaN)).toBe(b);
    expect(withLatentDemand(null, 2)).toBeNull();
  });
});
