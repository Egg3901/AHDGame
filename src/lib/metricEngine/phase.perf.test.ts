import { describe, expect, it } from "vitest";
import { evaluateRegistry } from "./evaluate";
import { METRIC_REGISTRY_SORTED } from "./registry";
import type { SectorRevenueTaxPayload } from "./registry/economic";

/**
 * R4/B2 perf + heap gate — COMPUTE-level micro-benchmark.
 *
 * Skipped unless `RUN_PERF=1` (timing/heap assertions are environment-sensitive
 * and would flake the normal suite). Run: `RUN_PERF=1 npx vitest run phase.perf`.
 *
 * SCOPE / honesty: this measures the *added compute* the engine introduces —
 * `evaluateRegistry` over ~107 states — which is the only new per-turn cost in
 * P0. It does NOT measure the full per-turn wall-clock or peak heap at production
 * scale, because that needs a real Mongo + the live turn pipeline (the reads +
 * bulkWrite are unchanged from the deleted gdpGrowth phase, so I/O cost is at
 * parity). The blocking production gate the spec (R4/B2) describes — "engine
 * phase ≤ N ms/turn and peak-heap ≤ M at full region count + worst-case corp
 * churn, N/M pinned from a measured baseline" — MUST be run as a staging/real-DB
 * benchmark before P2+ materially grows the node count (127 nodes) or P1 adds the
 * per-region age-vector subdocs (the documented OOM-history heap risk). Capture
 * the baseline number there; this micro-benchmark only guards against a gross
 * compute regression in the engine core.
 */

const REGION_COUNT = 107; // full live region count
const ITERATIONS = 200; // simulate many turns of compute
// Generous compute ceiling: the engine's per-"turn" compute over all regions.
// With 2 nodes this is microseconds; the ceiling exists to catch an O(N²) or
// per-state re-sort regression, not to assert the production budget.
const MAX_COMPUTE_MS_PER_TURN = 25;
const MAX_HEAP_GROWTH_MB = 50; // guards against per-iteration allocation leaks

const RUN = process.env.RUN_PERF === "1";
const perfDescribe = RUN ? describe : describe.skip;

function buildStateInputs(count: number) {
  const inputs = [];
  for (let i = 0; i < count; i++) {
    const payload: SectorRevenueTaxPayload = {
      owned: [
        { revenue: 1000 + i, currentGrowthRate: 2 + (i % 5) },
        { revenue: 3000 + i, currentGrowthRate: 1 + (i % 3) },
      ],
      unowned: [{ revenue: 5000 + i }],
      federalSalesTax: 0,
      stateSalesTax: 6,
      countryId: "US",
    };
    inputs.push({
      stateId: `s${i}`,
      prev: { "economic.gdpGrowth": 2.5, "economic.unemploymentRate": 5 },
      prevSimBaseline: { "economic.gdpGrowth": 2.4, "economic.unemploymentRate": 5 },
      providers: { sectorRevenueTax: payload },
      spending: {},
      policyValues: { "economic.gdpGrowth": 2.5 },
    });
  }
  return inputs;
}

perfDescribe("runMetricEngine compute perf (R4/B2 micro-benchmark)", () => {
  it(`evaluates ${REGION_COUNT} regions × ${ITERATIONS} turns under ${MAX_COMPUTE_MS_PER_TURN}ms/turn`, () => {
    const inputs = buildStateInputs(REGION_COUNT);
    // warm-up
    for (const input of inputs) evaluateRegistry(METRIC_REGISTRY_SORTED, input);

    const start = performance.now();
    for (let t = 0; t < ITERATIONS; t++) {
      for (const input of inputs) evaluateRegistry(METRIC_REGISTRY_SORTED, input);
    }
    const elapsed = performance.now() - start;
    const perTurn = elapsed / ITERATIONS;
    console.log(
      `[perf] engine compute: ${perTurn.toFixed(3)} ms/turn over ${REGION_COUNT} regions`
    );
    expect(perTurn).toBeLessThan(MAX_COMPUTE_MS_PER_TURN);
  });

  it(`does not grow heap beyond ${MAX_HEAP_GROWTH_MB}MB over ${ITERATIONS} turns`, () => {
    const inputs = buildStateInputs(REGION_COUNT);
    if (global.gc) global.gc();
    const before = process.memoryUsage().heapUsed;
    for (let t = 0; t < ITERATIONS; t++) {
      for (const input of inputs) evaluateRegistry(METRIC_REGISTRY_SORTED, input);
    }
    if (global.gc) global.gc();
    const growthMb = (process.memoryUsage().heapUsed - before) / (1024 * 1024);
    console.log(`[perf] heap growth: ${growthMb.toFixed(2)} MB`);
    expect(growthMb).toBeLessThan(MAX_HEAP_GROWTH_MB);
  });
});
