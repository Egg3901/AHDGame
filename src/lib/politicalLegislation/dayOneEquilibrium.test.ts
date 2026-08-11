/**
 * §4 day-one equilibrium — the construction guarantee: with
 * residual = seed − dayOneTarget, the composed target equals the seed exactly
 * for EVERY metric of EVERY catalog (regions start with no regional
 * enactments, so the supplement is 0). Asserted pointwise, not spot-checked.
 */

import { describe, expect, it } from "vitest";
import { getCatalog } from "./catalog";
import { composeTarget, lawTargets } from "./dynamics";

describe("§4 day-one equilibrium (construction guarantee)", () => {
  for (const countryId of ["US", "UK", "RU", "DD"] as const) {
    it(`${countryId}: residual = seed − dayOneTarget makes target === seed for every metric`, () => {
      const levels = new Map(
        getCatalog(countryId)
          .filter((l) => l.kind !== "tax")
          .map((l) => [l.id, l.baselineLevel ?? 0])
      );
      const national = lawTargets(countryId, levels);
      for (const seed of [0, 12.3, 50, 87.7, 100]) {
        for (const points of Object.values(national)) {
          const residual = seed - points;
          expect(composeTarget(points, 0, residual)).toBeCloseTo(seed, 9);
        }
      }
    });
  }
});
