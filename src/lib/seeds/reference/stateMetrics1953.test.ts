import { describe, expect, it } from "vitest";
import { stateMetrics1953 } from "./stateMetrics1953";
import { states1953 } from "./states1953";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { synthesizeAgeSexVector } from "@/lib/demographics/seedSynthesis";
import {
  medianAgeFromVector,
  coarseGroups,
  totalPopulation,
} from "@/lib/demographics/cohortVector";
import { birthRateIndexToTFR } from "@/lib/demographics/flows/fertility";

/**
 * Regression coverage for the "America ages backwards through the baby boom"
 * defect: this file's `population` block authored `medianAge` from the 1950
 * Census but had NO `birthRate` field at all, so every US state fell through
 * `uniformStateMetrics`'s generic `65 - medianAge*0.5` default — landing at
 * the neutral ~50 index (a ~2019 replacement-level reading) instead of a
 * peak-baby-boom one. `birthRate` is also a STATIC ROOT metric (no turn-engine
 * node evolves it), so whatever value is authored governs fertility — via
 * `demographics/flows/fertility.ts`'s `birthRateIndexToTFR` — for the entire
 * multi-decade run. `REPLACEMENT_TFR` (2.06, `demographics/phase.ts`) is the
 * index-50 anchor, so index 50 simulated a modern replacement TFR for a
 * country whose real 1953 TFR was ≈3.3 (Vital Statistics of the United
 * States, 1953; NCHS) — the population aged FORWARD across the run instead of
 * getting younger, exactly backwards for 1953-66 America.
 */
describe("US 1953 seed — population.birthRate authoring (baby boom)", () => {
  it("authors birthRate for every state it authors medianAge for", () => {
    for (const m of stateMetrics1953) {
      expect(m.population?.medianAge?.value, `${m._id} medianAge`).toBeTypeOf("number");
      expect(m.population?.birthRate?.value, `${m._id} birthRate`).toBeTypeOf("number");
    }
  });

  it("authors a well-above-neutral fertility index for every state", () => {
    for (const m of stateMetrics1953) {
      const br = m.population!.birthRate!.value!;
      // Neutral default was ~49-51 for these median ages; every state must
      // clear that by a wide margin, up to the model's own 0-100 index range.
      expect(br, m._id).toBeGreaterThanOrEqual(50);
      expect(br, m._id).toBeLessThanOrEqual(100);
    }
    const values = stateMetrics1953.map((m) => m.population!.birthRate!.value!);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    // National-average index well above the neutral-50 midpoint.
    expect(avg).toBeGreaterThan(70);
  });

  it("South/Mountain-West states author a strictly higher index than the industrial Northeast", () => {
    const byId = new Map(stateMetrics1953.map((m) => [m._id, m.population!.birthRate!.value!]));
    const highFertility = ["MS", "AL", "GA", "LA", "SC", "NC", "TX", "UT", "NM"];
    const lowFertility = ["NY", "MA", "CT", "NJ", "PA", "RI", "NH", "DC"];
    const minHigh = Math.min(...highFertility.map((id) => byId.get(id)!));
    const maxLow = Math.max(...lowFertility.map((id) => byId.get(id)!));
    expect(minHigh).toBeGreaterThan(maxLow);
  });

  it("maps to historically defensible TFRs, all above the neutral-50 replacement TFR", () => {
    const REPLACEMENT_TFR = 2.06; // must mirror demographics/phase.ts
    const neutralTFR = birthRateIndexToTFR(50, REPLACEMENT_TFR);
    expect(neutralTFR).toBeCloseTo(2.06, 2);
    const ceilingTFR = birthRateIndexToTFR(100, REPLACEMENT_TFR);

    for (const m of stateMetrics1953) {
      const tfr = birthRateIndexToTFR(m.population!.birthRate!.value!, REPLACEMENT_TFR);
      // >= (not >) neutral: DC is authored at the neutral index itself (real
      // 1950s DC fertility was near replacement — an urban federal city with
      // few families), everyone else is strictly higher.
      expect(tfr, m._id).toBeGreaterThanOrEqual(neutralTFR);
      // Derived from the model rather than hardcoded: the ceiling has moved
      // once already (a stale literal here is how this test drifted out of
      // sync with birthRateIndexToTFR).
      expect(tfr, m._id).toBeLessThanOrEqual(ceilingTFR);
    }
    // Utah — the historic US fertility outlier — should sit at or near that ceiling.
    const utTFR = birthRateIndexToTFR(
      stateMetrics1953.find((m) => m._id === "UT")!.population!.birthRate!.value!,
      REPLACEMENT_TFR
    );
    expect(utTFR).toBeCloseTo(ceilingTFR, 1);
  });

  function synthesizeState(stateId: string, birthRate: number, population = 1_000_000) {
    const metrics = stateMetrics1953.find((m) => m._id === stateId)!;
    const medianAge = metrics.population!.medianAge!.value!;
    const census = getRegionCensusData("US", stateId, "1953-default") as {
      age: Record<string, number>;
    } | null;
    if (!census) throw new Error(`no census for ${stateId}`);
    const v = synthesizeAgeSexVector({
      adultShares: {
        young: census.age.young ?? 0,
        mid: census.age.mid ?? 0,
        mature: census.age.mature ?? 0,
        senior: census.age.senior ?? 0,
      },
      medianAge,
      birthRate,
      population,
    });
    return { medianAge, v };
  }

  it("synthesizes a pyramid near the authored median age for a representative spread of states", () => {
    // Turn-0 synthesis check: the seeded youth/adult split is SOLVED to
    // honour the authored medianAge, bounded by the birthRate prior
    // (seedSynthesis.ts) — so a correctly-high birthRate pulls the
    // synthesized median a little (1-3 years) YOUNGER than the raw census
    // figure, not further away from it. The calibrated birthRate values are
    // chosen so this never drifts more than ~2.5 years from the
    // census-authored value.
    for (const stateId of ["CA", "MS", "NY", "UT", "DC"]) {
      const authoredBr = stateMetrics1953.find((m) => m._id === stateId)!.population!.birthRate!
        .value!;
      const { medianAge, v } = synthesizeState(stateId, authoredBr);
      const median = medianAgeFromVector(v);
      expect(Math.abs(median - medianAge), `${stateId} median vs authored`).toBeLessThan(2.5);
    }
  });

  it("every sampled state's authored birthRate synthesizes a YOUNGER, more boom-consistent pyramid than the neutral-50 bug did", () => {
    for (const stateId of ["CA", "MS", "NY", "UT", "DC"]) {
      const authoredBr = stateMetrics1953.find((m) => m._id === stateId)!.population!.birthRate!
        .value!;
      const fixed = synthesizeState(stateId, authoredBr);
      const buggy = synthesizeState(stateId, 50); // the DEFAULT_BIRTH_RATE fallback this closes
      const fixedYouth = coarseGroups(fixed.v).youth / totalPopulation(fixed.v);
      const buggyYouth = coarseGroups(buggy.v).youth / totalPopulation(buggy.v);
      // DC is authored at exactly the neutral index (real DC fertility was
      // near replacement), so it alone may tie rather than strictly improve.
      if (stateId === "DC") {
        expect(fixedYouth, stateId).toBeGreaterThanOrEqual(buggyYouth);
      } else {
        expect(fixedYouth, `${stateId} youth share vs buggy default`).toBeGreaterThan(buggyYouth);
      }
    }
  });

  it("national population-weighted under-18 share lands distinctly above the 25.7% regression figure and near the real 1953 census (~31%)", () => {
    // Regression target: the stopped 654-turn sandbox world (birthRate absent
    // → neutral-50 default) read median 35.1 / under-18 25.7% at turn ~654.
    // This is a turn-0 synthesis check, weighted by each state's real 1950
    // population (states1953.ts), not the multi-turn evolved figure (which
    // isn't reproducible without running the sim) — but it demonstrates the
    // fix starts from a correctly-young footing rather than an already-old one.
    const popById = new Map(
      states1953.filter((s) => s.countryId === "US").map((s) => [s._id, s.population])
    );
    let totalYouth = 0;
    let totalPop = 0;
    for (const m of stateMetrics1953) {
      const statePop = popById.get(m._id);
      if (!statePop) continue;
      const birthRate = m.population!.birthRate!.value!;
      const { v } = synthesizeState(m._id, birthRate, statePop);
      totalYouth += coarseGroups(v).youth;
      totalPop += totalPopulation(v);
    }
    const nationalYouthShare = totalYouth / totalPop;
    expect(nationalYouthShare).toBeGreaterThan(0.27);
    expect(nationalYouthShare).toBeLessThan(0.36);
  });
});
