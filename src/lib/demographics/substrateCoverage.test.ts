/**
 * G1 gate. Every seeded region must derive a granular-electorate substrate in
 * every era it seeds in.
 *
 * This is the check that makes retiring the archetype catalogs safe. The vote
 * path being green proves nothing on its own: a region with no census silently
 * falls back to the archetype documents today, so the gap is invisible right up
 * until the fallback is deleted and the region has no electorate.
 */

import { describe, expect, it } from "vitest";
import { ALL_COUNTRY_IDS } from "@/lib/constants/countries";
import { coverageForCountry, failingRows } from "./substrateCoverage";

describe("granular substrate coverage (G1)", () => {
  for (const countryId of ALL_COUNTRY_IDS) {
    it(`${countryId}: every seeded region has a substrate in every era`, async () => {
      const rows = await coverageForCountry(countryId);
      expect(rows.length).toBeGreaterThan(0);
      const bad = failingRows(rows).map(
        (r) => `${r.countryId}/${r.era}/${r.regionId}@${r.year ?? "preset"} units=${r.units}`
      );
      expect(bad).toEqual([]);
    });
  }
});
