import { describe, expect, it } from "vitest";
import { advanceCohort, type CohortInputs } from "./cohortFlows";
import { synthesizeAgeSexVector } from "./seedSynthesis";
import { totalPopulation } from "./cohortVector";

const TPY = 48;
const baseVector = () =>
  synthesizeAgeSexVector({
    adultShares: { young: 25, mid: 27, mature: 30, senior: 18 },
    medianAge: 38,
    birthRate: 50,
    population: 1_000_000,
  });
const inputs: CohortInputs = {
  replacementTFR: 2.1,
  birthRateIndex: 50,
  healthcare: { lifeExpectancy: 50, preventableMortality: 50 },
  netInternationalMigrants: 0,
  migrantShareMale: 0.5,
};

describe("advanceCohort", () => {
  it("returns a vector and flow tallies (births, deaths, netMigration)", () => {
    const { vector, flows } = advanceCohort(baseVector(), inputs, 1, TPY);
    expect(vector.male).toHaveLength(101);
    expect(flows.births).toBeGreaterThan(0);
    expect(flows.deaths).toBeGreaterThan(0);
    expect(flows.netMigration).toBe(0);
  });
  it("keeps every cell non-negative", () => {
    const { vector } = advanceCohort(baseVector(), inputs, 1, TPY);
    for (let a = 0; a <= 100; a++) {
      expect(vector.male[a]).toBeGreaterThanOrEqual(0);
      expect(vector.female[a]).toBeGreaterThanOrEqual(0);
    }
  });
  it("applies aging every turn (continuous), not only on year boundaries", () => {
    const v = baseVector();
    const t1 = advanceCohort(v, inputs, 1, TPY).vector; // non-boundary turn
    const t5 = advanceCohort(v, inputs, 5, TPY).vector; // also non-boundary
    // continuous aging shifts the structure on EVERY turn, so a mid-pyramid cell
    // moves regardless of turn % 48 — unlike the old year-boundary-only shift
    expect(t1.male[40]).not.toBeCloseTo(v.male[40], 0);
    expect(t5.male[40]).not.toBeCloseTo(v.male[40], 0);
  });
  it("passes servingFemaleByAge into the fertility flow (conscription lowers births)", () => {
    const base = advanceCohort(baseVector(), inputs, 1, TPY).flows.births;
    const serving = Array.from({ length: 101 }, (_, a) => (a >= 18 && a <= 20 ? 5000 : 0));
    const withService = advanceCohort(
      baseVector(),
      { ...inputs, servingFemaleByAge: serving },
      1,
      TPY
    ).flows.births;
    expect(withService).toBeLessThan(base);
  });

  it("an all-zero region stays empty (no negative, no spontaneous births)", () => {
    const tiny = { male: new Array(101).fill(0), female: new Array(101).fill(0) };
    const { vector } = advanceCohort(tiny, inputs, 1, TPY);
    expect(totalPopulation(vector)).toBe(0);
  });
});
