import { describe, expect, it } from "vitest";
import {
  migrantAgeSexProfile,
  applyInternationalMigration,
  economicPullFactor,
  applyEconomicPull,
  capNetMigrants,
  worldMigrationScale,
  MAX_NET_MIGRATION_PCT_PER_YEAR,
  WORLD_NET_MIGRATION_PCT_PER_YEAR,
} from "./internationalMigration";
import { totalPopulation, type AgeSexVector } from "../cohortVector";
import { advanceCohort, type CohortInputs } from "../cohortFlows";
import { synthesizeAgeSexVector } from "../seedSynthesis";

function flat(perCell = 1000): AgeSexVector {
  const arr = () => Array.from({ length: 101 }, () => perCell);
  return { male: arr(), female: arr() };
}

describe("capNetMigrants", () => {
  const TPY = 48;
  it("leaves a within-cap net untouched", () => {
    // 0.5%/yr of 1,000,000 / 48 ≈ 104/turn, under the 1.5%/yr cap
    const net = ((0.5 / 100) * 1_000_000) / TPY;
    expect(capNetMigrants(net, 1_000_000, TPY)).toBeCloseTo(net, 6);
  });
  it("clamps an over-cap immigration net to +MAX%/yr", () => {
    const pop = 1_000_000;
    const cap = ((MAX_NET_MIGRATION_PCT_PER_YEAR / 100) * pop) / TPY;
    // request 10%/yr — far over cap
    const requested = ((10 / 100) * pop) / TPY;
    expect(capNetMigrants(requested, pop, TPY)).toBeCloseTo(cap, 6);
  });
  it("clamps an over-cap emigration net symmetrically", () => {
    const pop = 1_000_000;
    const cap = ((MAX_NET_MIGRATION_PCT_PER_YEAR / 100) * pop) / TPY;
    const requested = -((10 / 100) * pop) / TPY;
    expect(capNetMigrants(requested, pop, TPY)).toBeCloseTo(-cap, 6);
  });
  it("returns 0 for a zero/invalid population", () => {
    expect(capNetMigrants(500, 0, TPY)).toBe(0);
  });
  it("the cap survives econPull amplification (apply cap AFTER pull)", () => {
    const pop = 1_000_000;
    const cap = ((MAX_NET_MIGRATION_PCT_PER_YEAR / 100) * pop) / TPY;
    const base = ((1.2 / 100) * pop) / TPY; // 1.2%/yr, under cap before pull
    const pulled = applyEconomicPull(base, 1.5); // ×1.5 → 1.8%/yr, over cap
    expect(pulled).toBeGreaterThan(cap);
    expect(capNetMigrants(pulled, pop, TPY)).toBeCloseTo(cap, 6);
  });
});

describe("worldMigrationScale", () => {
  const TPY = 48;
  it("returns 1 when the bloc is within the world bound", () => {
    const totalPop = 1_000_000_000;
    // total positive = 0.1%/yr, under the 0.3%/yr world cap
    const net = ((0.1 / 100) * totalPop) / TPY;
    expect(worldMigrationScale([net], totalPop, TPY)).toBe(1);
  });
  it("scales positives down when the bloc exceeds the world bound", () => {
    const totalPop = 1_000_000_000;
    const worldCap = ((WORLD_NET_MIGRATION_PCT_PER_YEAR / 100) * totalPop) / TPY;
    // request 3%/yr of inflow — 10× the bound
    const net = ((3 / 100) * totalPop) / TPY;
    const scale = worldMigrationScale([net], totalPop, TPY);
    expect(scale).toBeCloseTo(worldCap / net, 6);
    expect(net * scale).toBeCloseTo(worldCap, 4);
  });
  it("never scales a net-emigrating world (returns 1)", () => {
    const totalPop = 1_000_000_000;
    const out = -((2 / 100) * totalPop) / TPY;
    expect(worldMigrationScale([out, out], totalPop, TPY)).toBe(1);
  });
  it("only positive nets count toward the bound (outflows ignored)", () => {
    const totalPop = 1_000_000_000;
    const worldCap = ((WORLD_NET_MIGRATION_PCT_PER_YEAR / 100) * totalPop) / TPY;
    const inflow = ((1 / 100) * totalPop) / TPY; // over bound alone
    const outflow = -((5 / 100) * totalPop) / TPY; // large outflow
    const scale = worldMigrationScale([inflow, outflow], totalPop, TPY);
    expect(scale).toBeCloseTo(worldCap / inflow, 6);
  });
});

describe("cap + world-bound together (no-balloon guarantee)", () => {
  const TPY = 48;
  it("an all-positive over-cap world nets ≤ WORLD_NET%/yr after cap + scale", () => {
    // 7 'countries' all demanding +10%/yr inflow (the live failure mode).
    const pops = [
      1_120_000_000, 249_000_000, 147_000_000, 124_000_000, 80_000_000, 58_000_000, 3_500_000,
    ];
    const totalPop = pops.reduce((a, b) => a + b, 0);
    const rawNets = pops.map((p) => ((10 / 100) * p) / TPY); // 10%/yr each — absurd
    const capped = rawNets.map((n, i) => capNetMigrants(n, pops[i], TPY));
    const scale = worldMigrationScale(capped, totalPop, TPY);
    const finalNets = capped.map((n) => (n >= 0 ? n * scale : n));
    const worldNetPerTurn = finalNets.reduce((a, b) => a + b, 0);
    const annualizedPct = ((worldNetPerTurn * TPY) / totalPop) * 100;
    expect(annualizedPct).toBeLessThanOrEqual(WORLD_NET_MIGRATION_PCT_PER_YEAR + 1e-9);
  });
  it("a realistic mixed world (small ±) is left essentially unscaled", () => {
    const pops = [1_120_000_000, 249_000_000, 80_000_000];
    const totalPop = pops.reduce((a, b) => a + b, 0);
    // CN ~0, US +0.4%, DE +0.4% — bloc net well under the 0.3%/yr bound
    const ratesPct = [0.0, 0.4, 0.4];
    const capped = ratesPct.map((r, i) =>
      capNetMigrants(((r / 100) * pops[i]) / TPY, pops[i], TPY)
    );
    const scale = worldMigrationScale(capped, totalPop, TPY);
    expect(scale).toBe(1);
  });
});

describe("migrantAgeSexProfile", () => {
  it("sums to 1 across all cells", () => {
    const p = migrantAgeSexProfile(0.5);
    let s = 0;
    for (let a = 0; a <= 100; a++) s += p.male[a] + p.female[a];
    expect(s).toBeCloseTo(1, 9);
  });
  it("peaks in young-adult ages (22-32)", () => {
    const p = migrantAgeSexProfile(0.5);
    expect(p.male[27] + p.female[27]).toBeGreaterThan(p.male[60] + p.female[60]);
  });
  it("a male-skewed corridor puts more weight on male cells", () => {
    const skewed = migrantAgeSexProfile(0.7);
    let m = 0,
      f = 0;
    for (let a = 0; a <= 100; a++) {
      m += skewed.male[a];
      f += skewed.female[a];
    }
    expect(m).toBeGreaterThan(f);
  });
});

describe("applyInternationalMigration", () => {
  it("adds net in-migrants distributed by the profile, conserving the requested total", () => {
    const profile = migrantAgeSexProfile(0.5);
    const { vector, applied } = applyInternationalMigration(flat(1000), 10000, profile);
    expect(applied).toBeCloseTo(10000, 0);
    expect(totalPopulation(vector)).toBeCloseTo(totalPopulation(flat(1000)) + 10000, 0);
  });
  it("net out-migration removes people but never drives a cell negative (local clamp)", () => {
    const profile = migrantAgeSexProfile(0.5);
    const { vector } = applyInternationalMigration(flat(10), -1_000_000, profile);
    for (let a = 0; a <= 100; a++) {
      expect(vector.male[a]).toBeGreaterThanOrEqual(0);
      expect(vector.female[a]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("economicPullFactor (output-gap economic pull on international intake)", () => {
  it("growing at own potential with neutral unemployment yields exactly 1.0 (parity)", () => {
    expect(economicPullFactor({ gdpGrowth: 2.5, unemployment: 5, potential: 2.5 })).toBeCloseTo(
      1.0,
      9
    );
  });

  it("v0 doom-loop fix: a region at its own LOW potential is migration-neutral (≈1)", () => {
    // UK-like: weak potential but growing at it → no perpetual shedding. Under the
    // old absolute-vs-2.5 formula this returned < 1 (the doom engine).
    expect(economicPullFactor({ gdpGrowth: -0.9, unemployment: 5, potential: -0.9 })).toBeCloseTo(
      1.0,
      9
    );
  });

  it("running ABOVE potential pulls more (>1); BELOW potential pulls fewer (<1)", () => {
    expect(economicPullFactor({ gdpGrowth: 6, unemployment: 3, potential: 2.5 })).toBeGreaterThan(
      1
    );
    expect(economicPullFactor({ gdpGrowth: -1, unemployment: 12, potential: 2.5 })).toBeLessThan(1);
  });

  it("clamps to [0.5, 1.5] at extreme output gaps", () => {
    expect(economicPullFactor({ gdpGrowth: 30, unemployment: 0, potential: 2.5 })).toBeCloseTo(
      1.5,
      9
    );
    expect(economicPullFactor({ gdpGrowth: -20, unemployment: 40, potential: 2.5 })).toBeCloseTo(
      0.5,
      9
    );
  });
});

describe("applyEconomicPull (sign-aware, policy-gated)", () => {
  it("scales immigration UP with a strong economy, DOWN with a weak one", () => {
    expect(applyEconomicPull(100, 1.5)).toBeCloseTo(150, 6);
    expect(applyEconomicPull(100, 0.5)).toBeCloseTo(50, 6);
  });

  it("a weak economy DEEPENS net emigration; a strong one reduces it", () => {
    expect(applyEconomicPull(-100, 0.5)).toBeCloseTo(-150, 6); // weak → more leave
    expect(applyEconomicPull(-100, 1.5)).toBeCloseTo(-50, 6); // strong → fewer leave
  });

  it("a closed border (base 0) stays 0 regardless of economy (policy gate)", () => {
    expect(applyEconomicPull(0, 1.5)).toBe(0);
    expect(applyEconomicPull(0, 0.5)).toBe(0);
  });
});

describe("economic pull — end-to-end additive effect over 240 turns (sim)", () => {
  const seed = () =>
    synthesizeAgeSexVector({
      adultShares: { young: 24, mid: 27, mature: 31, senior: 18 },
      medianAge: 38,
      birthRate: 50,
      population: 1_000_000,
    });
  const inputs = (net: number): CohortInputs => ({
    replacementTFR: 2.06,
    birthRateIndex: 50,
    healthcare: { lifeExpectancy: 50, preventableMortality: 50 },
    netInternationalMigrants: net,
    migrantShareMale: 0.5,
  });
  function finalPop(pull: number, baseNet: number, turns = 240): number {
    let v = seed();
    const net = applyEconomicPull(baseNet, pull);
    for (let t = 1; t <= turns; t++) v = advanceCohort(v, inputs(net), t, 48).vector;
    return totalPopulation(v);
  }

  it("with identical policy intake, a stronger regional economy ends with a larger population", () => {
    const baseNet = 500; // same per-turn policy intake for all three
    const booming = finalPop(
      economicPullFactor({ gdpGrowth: 6, unemployment: 3, potential: 2.5 }),
      baseNet
    );
    const neutral = finalPop(
      economicPullFactor({ gdpGrowth: 2.5, unemployment: 5, potential: 2.5 }),
      baseNet
    );
    const depressed = finalPop(
      economicPullFactor({ gdpGrowth: -1, unemployment: 12, potential: 2.5 }),
      baseNet
    );
    expect(booming).toBeGreaterThan(neutral); // additive: stronger economy → more intake
    expect(depressed).toBeLessThan(neutral); // weaker economy → less intake
  });
});
