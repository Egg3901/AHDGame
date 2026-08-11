import { describe, expect, it } from "vitest";
import {
  CONSCRIPTION_OPTIONS,
  resolveConscriptionPolicy,
  estimateConscriptionEffects,
  type ConscriptionPolicy,
} from "./conscription";
import { synthesizeAgeSexVector } from "./seedSynthesis";
import { workingAgePopulation } from "./cohortVector";

describe("conscription option ladder", () => {
  it("has 7 rungs; objector inducts ~0, National Service inducts the most", () => {
    expect(CONSCRIPTION_OPTIONS).toHaveLength(7);
    expect(CONSCRIPTION_OPTIONS[0].inductionRate).toBe(0); // 1 Conscientious Objector
    expect(CONSCRIPTION_OPTIONS[6].inductionRate).toBeGreaterThan(
      CONSCRIPTION_OPTIONS[1].inductionRate
    ); // 7 National Service
  });
  it("induction is non-decreasing from rung 2 upward (draft > volunteer)", () => {
    for (let i = 2; i < 7; i++) {
      expect(CONSCRIPTION_OPTIONS[i].inductionRate).toBeGreaterThanOrEqual(
        CONSCRIPTION_OPTIONS[i - 1].inductionRate - 1e-9
      );
    }
  });
});

describe("resolveConscriptionPolicy", () => {
  it("falls back to the country seed rung with default band 18-20 male-only", () => {
    const p = resolveConscriptionPolicy("US", undefined);
    expect(p.eligibleBand[0]).toBe(18);
    expect(p.eligibleBand[1]).toBeLessThanOrEqual(29);
    expect(p.sexEnabled.female).toBe(false); // default male-only
    expect(p.option).toBeGreaterThanOrEqual(1);
  });
  it("honors an override (future law/UI), clamped to valid ranges", () => {
    const override: Partial<ConscriptionPolicy> = {
      eligibleBand: [18, 40], // hi clamped to 29
      sexEnabled: { male: true, female: true },
      option: 7,
    };
    const p = resolveConscriptionPolicy("US", override);
    expect(p.eligibleBand[1]).toBe(29); // clamped
    expect(p.sexEnabled.female).toBe(true);
    expect(p.option).toBe(7);
  });
  it("clamps an out-of-range option into 1..7", () => {
    expect(resolveConscriptionPolicy("US", { option: 99 }).option).toBe(7);
    expect(resolveConscriptionPolicy("US", { option: 0 }).option).toBe(1);
  });
});

describe("estimateConscriptionEffects", () => {
  const v = synthesizeAgeSexVector({
    adultShares: { young: 25, mid: 27, mature: 30, senior: 18 },
    medianAge: 38,
    birthRate: 50,
    population: 1_000_000,
  });
  const labor = workingAgePopulation(v);

  it("option 1 (objector) withdraws nobody", () => {
    const e = estimateConscriptionEffects(
      { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 1 },
      v
    );
    expect(e.activeServingPop).toBe(0);
    expect(e.servingFemaleByAge.every((x) => x === 0)).toBe(true);
  });

  it("male-only service withdraws only men → zero female serving (no fertility hit)", () => {
    const e = estimateConscriptionEffects(
      { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 7 },
      v
    );
    expect(e.servingMale).toBeGreaterThan(0);
    expect(e.servingFemale).toBe(0);
    expect(e.servingFemaleByAge.every((x) => x === 0)).toBe(true);
    expect(e.activeServingPop).toBeCloseTo(e.servingMale, 6);
  });

  it("both-sex National Service stays under the ~2.5% labor ceiling", () => {
    const e = estimateConscriptionEffects(
      { eligibleBand: [18, 29], sexEnabled: { male: true, female: true }, option: 7 },
      v
    );
    expect(e.activeServingPop).toBeLessThanOrEqual(0.025 * labor + 1);
    expect(e.servingFemale).toBeGreaterThan(0);
    const cb = e.servingFemaleByAge.reduce((s, x) => s + x, 0);
    expect(cb).toBeCloseTo(e.servingFemale, 0); // band ⊆ [18,44]
  });

  it("a WIDER band does not grow the active force (serviceTerm caps it, F-1)", () => {
    const narrow = estimateConscriptionEffects(
      { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 7 },
      v
    ).activeServingPop;
    const wide = estimateConscriptionEffects(
      { eligibleBand: [18, 29], sexEnabled: { male: true, female: false }, option: 7 },
      v
    ).activeServingPop;
    expect(wide).toBeLessThan(narrow * 1.5);
    expect(wide).toBeGreaterThan(narrow * 0.5);
  });

  it("laborForceDelta is the negative of activeServingPop", () => {
    const e = estimateConscriptionEffects(
      { eligibleBand: [18, 20], sexEnabled: { male: true, female: false }, option: 6 },
      v
    );
    expect(e.laborForceDelta).toBeCloseTo(-e.activeServingPop, 6);
  });
});
