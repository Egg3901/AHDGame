import { describe, expect, it } from "vitest";
import { derivePopulationMetrics } from "./populationMetrics";
import { synthesizeAgeSexVector, type SeedSynthesisInput } from "./seedSynthesis";

const TPY = 48;
const base: SeedSynthesisInput = {
  adultShares: { young: 25, mid: 27, mature: 30, senior: 18 },
  medianAge: 38,
  birthRate: 50,
  population: 1_000_000,
};
const before = synthesizeAgeSexVector(base);
const after = synthesizeAgeSexVector({ ...base, population: 1_010_000 }); // +1% over a turn

describe("derivePopulationMetrics", () => {
  it("populationGrowth is the ANNUALIZED percent change (per-turn Δ × turnsPerYear)", () => {
    const m = derivePopulationMetrics(
      before,
      after,
      { births: 0, deaths: 0, netMigration: 10_000 },
      TPY
    );
    expect(m.populationGrowth).toBeGreaterThan(0);
    expect(m.populationGrowth).toBeCloseTo((1_010_000 / 1_000_000 - 1) * 100 * TPY, 0);
  });
  it("migrationRate is netMigration/population annualized, from the un-clamped flow", () => {
    const m = derivePopulationMetrics(
      before,
      after,
      { births: 0, deaths: 0, netMigration: 5_000 },
      TPY
    );
    expect(m.migrationRate).toBeCloseTo((5_000 / 1_010_000) * 100 * TPY, 0);
  });
  it("medianAge and sexRatio come from the AFTER vector", () => {
    const m = derivePopulationMetrics(
      before,
      after,
      { births: 0, deaths: 0, netMigration: 0 },
      TPY
    );
    expect(m.medianAge).toBeGreaterThan(20);
    expect(m.medianAge).toBeLessThan(60);
    expect(m.sexRatio).toBeGreaterThan(45);
    expect(m.sexRatio).toBeLessThan(55);
  });
  it("dependencyRatio and demographicDecline are present and finite", () => {
    const m = derivePopulationMetrics(
      before,
      after,
      { births: 100, deaths: 200, netMigration: 0 },
      TPY
    );
    expect(Number.isFinite(m.dependencyRatio)).toBe(true);
    expect(Number.isFinite(m.demographicDecline)).toBe(true);
  });
  it("demographicDecline rises when deaths exceed births (natural decrease)", () => {
    const declining = derivePopulationMetrics(
      before,
      after,
      { births: 50, deaths: 500, netMigration: 0 },
      TPY
    );
    const growing = derivePopulationMetrics(
      before,
      after,
      { births: 500, deaths: 50, netMigration: 0 },
      TPY
    );
    expect(declining.demographicDecline).toBeGreaterThan(growing.demographicDecline);
  });
});
