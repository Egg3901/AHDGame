import { describe, expect, it } from "vitest";
import {
  CONVERGENCE_BETA,
  CONVERGENCE_CAP,
  SECTOR_BLEND_WEIGHT,
  econSystemFactor,
  tradeFactor,
  freedomFactor,
  opennessGate,
  plannedDevelopmentGate,
  developmentGate,
  convergenceBonus,
  applySectorBlend,
} from "./convergence";

describe("econSystemFactor (SOCI 0–100 → openness component, floored at 0.5)", () => {
  it("maximally state-owned (SOCI ≥ 67) → the floor 0.5 (damped, not gutted)", () => {
    expect(econSystemFactor(67)).toBeCloseTo(0.5);
    expect(econSystemFactor(90)).toBeCloseTo(0.5);
  });
  it("market economy (SOCI ≤ 20) → 1", () => {
    expect(econSystemFactor(20)).toBeCloseTo(1);
    expect(econSystemFactor(5)).toBeCloseTo(1);
  });
  it("mid ownership (SOCI 40) → linear ramp above the floor (~0.57)", () => {
    expect(econSystemFactor(40)).toBeCloseTo((67 - 40) / (67 - 20), 2);
  });
  it("high-but-sub-command ownership (SOCI 60) → floored at 0.5 (ramp would be < 0.5)", () => {
    expect(econSystemFactor(60)).toBeCloseTo(0.5);
  });
  it("missing SOCI → 1 (assume market; absence must not suppress)", () => {
    expect(econSystemFactor(undefined)).toBeCloseTo(1);
  });
});

describe("tradeFactor (tradeGrowth vs world baseline)", () => {
  it("world-baseline trade (2.5) → 0.5", () => {
    expect(tradeFactor(2.5)).toBeCloseTo(0.5);
  });
  it("strong export growth (7.5) → 1", () => {
    expect(tradeFactor(7.5)).toBeCloseTo(1);
  });
  it("collapsed trade (-2.5) → 0", () => {
    expect(tradeFactor(-2.5)).toBeCloseTo(0);
  });
  it("missing → 0.5 (neutral)", () => {
    expect(tradeFactor(undefined)).toBeCloseTo(0.5);
  });
});

describe("freedomFactor (economicFreedom 0-100)", () => {
  it("freedom 60 → 1", () => {
    expect(freedomFactor(60)).toBeCloseTo(1);
  });
  it("freedom 25 → 0", () => {
    expect(freedomFactor(25)).toBeCloseTo(0);
  });
  it("freedom 42.5 → 0.5", () => {
    expect(freedomFactor(42.5)).toBeCloseTo(0.5);
  });
  it("missing → 0.5 (ramp value at the neutral midpoint)", () => {
    expect(freedomFactor(undefined)).toBeCloseTo(0.5);
  });
});

describe("opennessGate (weighted blend)", () => {
  it("all-open → 1", () => {
    expect(opennessGate({ econSystem: 1, trade: 1, freedom: 1 })).toBeCloseTo(1);
  });
  it("all-closed → 0", () => {
    expect(opennessGate({ econSystem: 0, trade: 0, freedom: 0 })).toBeCloseTo(0);
  });
  it("weights are 0.5 / 0.3 / 0.2", () => {
    expect(opennessGate({ econSystem: 1, trade: 0, freedom: 0 })).toBeCloseTo(0.5);
    expect(opennessGate({ econSystem: 0, trade: 1, freedom: 0 })).toBeCloseTo(0.3);
    expect(opennessGate({ econSystem: 0, trade: 0, freedom: 1 })).toBeCloseTo(0.2);
  });
  it("reform-CN-like (econSystem 0.574, trade 1, freedom 0.3) stays high (~0.647)", () => {
    expect(opennessGate({ econSystem: 0.574, trade: 1, freedom: 0.3 })).toBeCloseTo(0.647, 2);
  });
});

describe("plannedDevelopmentGate", () => {
  it("rewards execution, skills, infrastructure, and bloc trade", () => {
    expect(
      plannedDevelopmentGate({
        industrialPolicyExecution: 0.8,
        workforceSkill: 75,
        transportEfficiency: 70,
        publicInvestmentEffort: 1,
        trade: 1,
      })
    ).toBeGreaterThan(0.75);
  });

  it("does not rescue an incapable plan economy", () => {
    expect(
      plannedDevelopmentGate({
        industrialPolicyExecution: 0.15,
        workforceSkill: 25,
        transportEfficiency: 20,
        trade: 0,
      })
    ).toBeLessThan(0.25);
  });
});

describe("developmentGate", () => {
  it("lets a capable command economy use its planned path", () => {
    const marketOnly = opennessGate({ econSystem: 0.5, trade: 0.5, freedom: 0 });
    const combined = developmentGate({
      soci: 85,
      tradeGrowth: 2.5,
      economicFreedom: 10,
      industrialPolicyExecution: 0.8,
      workforceSkill: 75,
      transportEfficiency: 70,
      publicInvestmentEffort: 0.8,
    });
    expect(combined).toBeGreaterThan(marketOnly);
  });

  it("keeps a market economy on the market path", () => {
    const combined = developmentGate({
      soci: 5,
      tradeGrowth: 7.5,
      economicFreedom: 60,
      industrialPolicyExecution: 1,
      workforceSkill: 100,
      transportEfficiency: 100,
    });
    expect(combined).toBeCloseTo(1);
  });

  it("gives seeded 1953 planned economies a viable route with sparse capacity metrics", () => {
    const soviet = developmentGate({
      soci: 100,
      tradeGrowth: 3.7,
      economicFreedom: 5.1,
      industrialPolicyExecution: 0.37,
      publicInvestmentEffort: 0.78,
    });
    const eastGerman = developmentGate({
      soci: 100,
      tradeGrowth: 2.3,
      economicFreedom: 40.3,
      industrialPolicyExecution: 0.28,
      publicInvestmentEffort: 0.75,
    });
    expect(soviet).toBeGreaterThan(0.5);
    expect(eastGerman).toBeGreaterThan(0.52);
  });
});

describe("convergenceBonus", () => {
  it("at parity (ownPc == frontierPc) → 0", () => {
    expect(convergenceBonus(50_000, 50_000, 1)).toBeCloseTo(0);
  });
  it("richer than frontier → 0 (never negative)", () => {
    expect(convergenceBonus(60_000, 50_000, 1)).toBeCloseTo(0);
  });
  it("far behind → capped at CONVERGENCE_CAP × openness", () => {
    expect(convergenceBonus(300, 50_000, 1)).toBeCloseTo(CONVERGENCE_CAP);
  });
  it("half openness halves the bonus", () => {
    expect(convergenceBonus(300, 50_000, 0.5)).toBeCloseTo(CONVERGENCE_CAP * 0.5);
  });
  it("moderate gap uncapped: β·ln(ratio) × openness", () => {
    expect(convergenceBonus(25_000, 50_000, 1)).toBeCloseTo(CONVERGENCE_BETA * Math.log(2), 3);
  });
  it("non-finite / non-positive inputs → 0 (safe)", () => {
    expect(convergenceBonus(0, 50_000, 1)).toBeCloseTo(0);
    expect(convergenceBonus(50_000, 0, 1)).toBeCloseTo(0);
    expect(convergenceBonus(Number.NaN, 50_000, 1)).toBeCloseTo(0);
  });
});

describe("applySectorBlend", () => {
  it("blends sector toward potential at the default weight", () => {
    expect(applySectorBlend(2, 8)).toBeCloseTo(2 + SECTOR_BLEND_WEIGHT * 6);
  });
  it("sector == potential → unchanged", () => {
    expect(applySectorBlend(3, 3)).toBeCloseTo(3);
  });
  it("explicit weight override", () => {
    expect(applySectorBlend(2, 8, 0.5)).toBeCloseTo(5);
  });
});
