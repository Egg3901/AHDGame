import { describe, expect, it } from "vitest";
import { advanceCohort, type CohortInputs } from "./cohortFlows";
import { synthesizeAgeSexVector } from "./seedSynthesis";
import { totalPopulation, coarseGroups } from "./cohortVector";

/**
 * Multi-turn stationarity (`__sim__`) — the core P1b-1 stability guarantee
 * (design §4.2 fertility detail, §6.1).
 *
 * CALIBRATION (recorded, dev machine 2026-06-10): with the realistic Gompertz
 * mortality schedule (age-65 ≈1.2%/yr … 100+ terminal 0.55), the schedule's
 * long-run replacement TFR is ≈ 2.06 (yr80→100 slope ≈ 1.00 there). RE-VERIFIED
 * under continuous per-turn aging (P1b-1b): slope at 2.06 = 0.9963, senior@100 =
 * 20.9% — the equilibrium is unchanged (over a year, continuous aging ≈ the
 * old discrete annual shift), so REPLACEMENT_TFR stays 2.06. The
 * synthesized seed pyramid (medianAge 38) is YOUNGER than the stable form, so the
 * population follows a DAMPED OSCILLATION (birth-boom echo): it peaks ~+7% around
 * year 30-40, then settles over ~80+ years — exactly the demographic-momentum
 * wobble the design warns against. So stationarity is asserted as a LONG-RUN
 * SLOPE (yr80→100), not a naive start→30yr ratio (which only measures the
 * transient). Bands are tolerance bands.
 */
const TPY = 48;
const REPLACEMENT_TFR = 2.06; // index-50 anchor; long-run-flat for this schedule

function seed(medianAge = 38, pop = 1_000_000) {
  return synthesizeAgeSexVector({
    adultShares: { young: 24, mid: 27, mature: 31, senior: 18 },
    medianAge,
    birthRate: 50,
    population: pop,
  });
}
function snapshots(tfr: number, marks: number[]): Record<number, { pop: number; senior: number }> {
  let v = seed();
  const inputs: CohortInputs = {
    replacementTFR: tfr,
    birthRateIndex: 50, // index 50 → replacement TFR
    healthcare: { lifeExpectancy: 50, preventableMortality: 50 },
    netInternationalMigrants: 0,
    migrantShareMale: 0.5,
  };
  const out: Record<number, { pop: number; senior: number }> = {};
  const maxYear = Math.max(...marks);
  for (let t = 1; t <= maxYear * TPY; t++) {
    v = advanceCohort(v, inputs, t, TPY).vector;
    const year = t / TPY;
    if (Number.isInteger(year) && marks.includes(year)) {
      const pop = totalPopulation(v);
      out[year] = { pop, senior: coarseGroups(v).senior / pop };
    }
  }
  return out;
}

describe("cohort stationarity (__sim__)", () => {
  it("at replacement TFR the long-run slope (yr80→100) is ~flat (±3%)", () => {
    const s = snapshots(REPLACEMENT_TFR, [80, 100]);
    const slope = s[100].pop / s[80].pop;
    expect(slope).toBeGreaterThan(0.97);
    expect(slope).toBeLessThan(1.03);
  });

  it("does not run away or collapse through the transient (start→yr80 within ±20%)", () => {
    const start = totalPopulation(seed());
    const s = snapshots(REPLACEMENT_TFR, [80]);
    const ratio = s[80].pop / start;
    expect(ratio).toBeGreaterThan(0.8);
    expect(ratio).toBeLessThan(1.2);
  });

  it("settles at a realistic over-65 share (~16-26%) for a replacement-level society", () => {
    const s = snapshots(REPLACEMENT_TFR, [100]);
    expect(s[100].senior).toBeGreaterThan(0.16);
    expect(s[100].senior).toBeLessThan(0.26);
  });

  it("above-replacement TFR grows the population; below shrinks it (40-year horizon)", () => {
    const start = totalPopulation(seed());
    const grow = snapshots(REPLACEMENT_TFR * 1.3, [40])[40].pop;
    const shrink = snapshots(REPLACEMENT_TFR * 0.7, [40])[40].pop;
    expect(grow).toBeGreaterThan(start * 1.05);
    expect(shrink).toBeLessThan(start * 0.97);
  });
});
