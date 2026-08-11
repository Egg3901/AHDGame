import { describe, it, expect } from "vitest";
import { COMPOSITION_WEIGHTS } from "./compositionWeights.generated";
import { buildCompositionWeights } from "../../../scripts/generate-composition-weights";

/**
 * The generated table must equal what the seeds say.
 *
 * `compositionWeights.generated.ts` exists so a client bundle can project
 * archetype effects without importing ~460KB of census data. That makes it a
 * second copy, and a second copy is only safe if it cannot drift — so this
 * rebuilds it from the seeds in memory and compares.
 *
 * If this fails, the seeds changed: run `npm run generate:composition`.
 */
describe("generated composition weights", () => {
  it("matches the seeds exactly", () => {
    expect(COMPOSITION_WEIGHTS).toEqual(buildCompositionWeights());
  });

  it("is non-vacuous", () => {
    const countries = Object.keys(COMPOSITION_WEIGHTS);
    expect(countries.length).toBeGreaterThanOrEqual(17);
    const archetypes = countries.reduce(
      (s, cc) => s + Object.keys(COMPOSITION_WEIGHTS[cc]).length,
      0
    );
    expect(archetypes).toBeGreaterThanOrEqual(130);
  });

  it("every archetype's weights sum to 1", () => {
    for (const [cc, table] of Object.entries(COMPOSITION_WEIGHTS)) {
      for (const [archetypeId, weights] of Object.entries(table)) {
        expect(weights.length, `${cc}:${archetypeId}`).toBeGreaterThan(0);
        const sum = weights.reduce((s, w) => s + w.w, 0);
        expect(sum, `${cc}:${archetypeId} weights must sum to 1`).toBeCloseTo(1, 6);
      }
    }
  });
});
