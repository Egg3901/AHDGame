import { describe, expect, it } from "vitest";
import { synthesizeAgeSexVector, type SeedSynthesisInput } from "./seedSynthesis";
import {
  totalPopulation,
  coarseGroups,
  workingAge,
  childbearing,
  medianAgeFromVector,
  sexRatioFromVector,
  dependencyRatio,
  type AgeSexVector,
} from "./cohortVector";

/**
 * R4/B2 — BLOCKING substrate perf/heap gate. This is the acceptance criterion
 * for the single-year age×sex substrate bet (design C4): if synthesizing and
 * deriving all views for the full region count, and holding that many vectors in
 * memory, is cheap, the bet is validated and P1b-1 may build flows on it. If it
 * is NOT cheap, STOP and revisit substrate granularity (coarse-cohort fallback)
 * before investing in flows.
 *
 * Skipped unless `RUN_PERF=1` (timing/heap assertions are environment-sensitive
 * and would flake the normal suite). Run:
 *   RUN_PERF=1 npx vitest run src/lib/demographics/cohortVector.perf.test.ts
 *
 * SCOPE / honesty: this measures the SUBSTRATE compute + footprint only —
 * synthesis + the six derived views over ~107 regions, and the resident heap of
 * holding 107 vectors. It does NOT measure the full per-turn wall-clock or peak
 * heap with the DB load of 107 subdocs + the cohort FLOWS; that full-pipeline
 * gate is re-measured at the end of P1b-1/P1b-2 against a real Mongo before the
 * flows ship. Recorded baseline numbers (this machine) are logged below for that
 * later gate to reference.
 */

const REGION_COUNT = 107; // full live region count
const ITERATIONS = 200; // simulate many turns of substrate compute
// Generous compute ceiling: catches an O(N²)/quadratic regression, not a
// production budget. Real measured value is logged.
const MAX_COMPUTE_MS_PER_TURN = 50;
// Resident footprint ceiling for holding REGION_COUNT vectors. The whole bet is
// that single-year vectors are tiny: 107 × 2 × 101 doubles ≈ 0.2 MB raw. The
// ceiling is loose to absorb measurement noise; the LOGGED number is the signal.
const MAX_RESIDENT_HEAP_MB = 25;

const RUN = process.env.RUN_PERF === "1";
const perfDescribe = RUN ? describe : describe.skip;

function buildInputs(count: number): SeedSynthesisInput[] {
  const inputs: SeedSynthesisInput[] = [];
  for (let i = 0; i < count; i++) {
    inputs.push({
      adultShares: {
        young: 22 + (i % 7),
        mid: 24 + (i % 5),
        mature: 34 + (i % 6),
        senior: 18 + (i % 9),
      },
      medianAge: 32 + (i % 14), // 32..45
      birthRate: 30 + (i % 50), // 30..79
      population: 500_000 + i * 25_000,
    });
  }
  return inputs;
}

function deriveAll(v: AgeSexVector) {
  // Touch every derived view so the optimizer can't elide the work.
  return (
    totalPopulation(v) +
    coarseGroups(v).senior +
    workingAge(v) +
    childbearing(v) +
    medianAgeFromVector(v) +
    sexRatioFromVector(v) +
    dependencyRatio(v)
  );
}

perfDescribe("cohort substrate perf + footprint (R4/B2 BLOCKING gate)", () => {
  it(`synthesizes + derives ${REGION_COUNT} regions under ${MAX_COMPUTE_MS_PER_TURN}ms/turn`, () => {
    const inputs = buildInputs(REGION_COUNT);
    // warm-up
    for (const input of inputs) deriveAll(synthesizeAgeSexVector(input));

    let sink = 0;
    const start = performance.now();
    for (let t = 0; t < ITERATIONS; t++) {
      for (const input of inputs) sink += deriveAll(synthesizeAgeSexVector(input));
    }
    const elapsed = performance.now() - start;
    const perTurn = elapsed / ITERATIONS;
    expect(sink).toBeGreaterThan(0); // keep the sink live
    console.log(
      `[perf] substrate synth+derive: ${perTurn.toFixed(3)} ms/turn over ${REGION_COUNT} regions ` +
        `(${(perTurn / REGION_COUNT).toFixed(4)} ms/region)`
    );
    expect(perTurn).toBeLessThan(MAX_COMPUTE_MS_PER_TURN);
  });

  it(`holds ${REGION_COUNT} vectors in under ${MAX_RESIDENT_HEAP_MB}MB resident`, () => {
    const inputs = buildInputs(REGION_COUNT);
    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;

    // Retain all vectors so the footprint is real (not GC'd mid-measure).
    const retained: AgeSexVector[] = inputs.map((i) => synthesizeAgeSexVector(i));

    if (global.gc) global.gc();
    const residentMb = (process.memoryUsage().heapUsed - before) / (1024 * 1024);
    expect(retained).toHaveLength(REGION_COUNT); // keep the array live
    console.log(
      `[perf] resident heap for ${REGION_COUNT} vectors: ${residentMb.toFixed(3)} MB ` +
        `(${((residentMb * 1024) / REGION_COUNT).toFixed(2)} KB/region)`
    );
    expect(residentMb).toBeLessThan(MAX_RESIDENT_HEAP_MB);
  });
});
