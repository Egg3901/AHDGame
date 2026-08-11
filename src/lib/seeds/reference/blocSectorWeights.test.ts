/**
 * Cold-War sector-weight coverage.
 *
 * `getCountrySectorWeights1953/1979` fall back to an EVEN 1/N split across all
 * 17 sectors when a country has no authored bundle. That fallback is silent —
 * nothing throws, nothing logs — so a missing entry reads as "seeded" while
 * actually giving the country an economy with no shape at all: no Silesian coal
 * for Poland, and technology/financial weighted the same as heavy manufacturing
 * in a command economy that had neither.
 *
 * Two ways to land in that fallback, and this file pins both:
 *   1. No entry for the country (every satellite was missing from the 1979 map).
 *   2. An entry under a key that is not the runtime CountryId — the USSR's
 *      bundle lives under "SU" and Byelorussia's under "BY", so both need the
 *      alias map. 1953 had one; 1979 did not, so the USSR itself fell through.
 */

import { describe, expect, it } from "vitest";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { getCountrySectorWeights1953 } from "./sectorSeedWeights1953";
import { getCountrySectorWeights1979 } from "./sectorSeedWeights1979";

/** The Cold-War bloc as it seeds: the USSR, the GDR, and the satellites. */
const BLOC: CountryId[] = ["RU", "DD", "PL", "HU", "RO", "BG", "CS", "YU", "BLR", "BAL"];

const EVEN = 1 / CORPORATION_TYPES.length;

/** True when the weights are the degenerate even split (i.e. the silent fallback). */
function isEvenSplit(weights: Record<string, number>): boolean {
  return Object.values(weights).every((w) => Math.abs(w - EVEN) < 1e-9);
}

describe.each([
  ["1953", getCountrySectorWeights1953],
  ["1979", getCountrySectorWeights1979],
])("%s sector weights: the Cold-War bloc has authored economies", (era, getWeights) => {
  for (const countryId of BLOC) {
    it(`${countryId} does not fall through to the even 1/N split`, () => {
      expect(isEvenSplit(getWeights(countryId)), `${countryId} ${era} is an even split`).toBe(
        false
      );
    });

    it(`${countryId} weights are normalised and non-negative`, () => {
      const weights = getWeights(countryId);
      const total = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 6);
      for (const [sector, w] of Object.entries(weights)) {
        expect(w, `${countryId} ${era} ${sector}`).toBeGreaterThanOrEqual(0);
      }
    });

    it(`${countryId} is an industrial economy, not a service one`, () => {
      // Every seeded bloc economy is manufacturing/extraction/agriculture-led.
      // This is the assertion that actually fails on a flat fallback, since the
      // even split puts manufacturing at 1/17 alongside media and entertainment.
      const w = getWeights(countryId);
      const heavy = w.manufacturing + w.extraction + w.agriculture + w.chemical_industries;
      expect(heavy, `${countryId} ${era} heavy-industry share`).toBeGreaterThan(0.3);
    });
  }

  it("no bloc member has a meaningful real-estate or financial market", () => {
    // Land was not traded and there were no capital markets anywhere in the
    // bloc — Yugoslavia's Western-facing banks are the one partial exception.
    // A few bundles carry a token real-estate weight for state housing
    // administration, so this asserts "negligible", not literally zero.
    for (const countryId of BLOC) {
      const w = getWeights(countryId);
      expect(w.real_estate, `${countryId} ${era} real_estate`).toBeLessThan(EVEN / 2);
      expect(w.financial, `${countryId} ${era} financial`).toBeLessThan(EVEN);
    }
  });
});

describe("bundle-key aliases resolve the Soviet republics", () => {
  // The USSR plays as "RU" but its authored bundle is keyed "SU"; Byelorussia
  // plays as "BLR" against a "BY" bundle. A missing alias is invisible except
  // as a flat economy, which is exactly what happened to the USSR in 1979.
  it("1953: RU and BLR resolve to their authored bundles", () => {
    expect(isEvenSplit(getCountrySectorWeights1953("RU"))).toBe(false);
    expect(isEvenSplit(getCountrySectorWeights1953("BLR"))).toBe(false);
  });

  it("1979: RU and BLR resolve to their authored bundles", () => {
    expect(isEvenSplit(getCountrySectorWeights1979("RU"))).toBe(false);
    expect(isEvenSplit(getCountrySectorWeights1979("BLR"))).toBe(false);
  });

  it("1979: the USSR is defense- and manufacturing-heavy, as authored", () => {
    const su = getCountrySectorWeights1979("RU");
    expect(su.manufacturing).toBeGreaterThan(EVEN);
    expect(su.defense).toBeGreaterThan(EVEN);
    expect(su.financial).toBe(0);
  });
});
