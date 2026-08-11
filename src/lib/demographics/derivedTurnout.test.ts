import { describe, expect, it } from "vitest";
import { CENSUS_TO_ARCHETYPE, calculateDerivedTurnout } from "./derivedTurnout";
import { getVoterArchetypeCategoriesForCountry } from "./countryDemographics";
import { REGION_CENSUS_LABELS } from "@/lib/constants/regionCensusLabels";

const ARCHETYPE_COUNTRIES = ["UK", "JP", "DE", "IE", "CN", "BR"] as const;

describe("derivedTurnout maps — structural integrity", () => {
  it("every archetype id in every map exists in that country's seed archetypes", () => {
    for (const cc of ARCHETYPE_COUNTRIES) {
      const map = CENSUS_TO_ARCHETYPE[cc];
      if (!map) continue;
      const validIds = new Set(
        getVoterArchetypeCategoriesForCountry(cc)[0].groups.map((g) => g.id)
      );
      for (const [census, archetypes] of Object.entries(map)) {
        for (const a of archetypes) {
          expect(validIds.has(a), `${cc}.${census} -> unknown archetype "${a}"`).toBe(true);
        }
      }
    }
  });

  it("every census category key in every map is a real census key for that country", () => {
    for (const cc of ARCHETYPE_COUNTRIES) {
      const map = CENSUS_TO_ARCHETYPE[cc];
      const labels = REGION_CENSUS_LABELS[cc];
      if (!map || !labels) continue;
      const validKeys = new Set([
        ...Object.keys(labels.ethnicity),
        ...Object.keys(labels.age),
        ...Object.keys(labels.education),
        ...Object.keys(labels.income),
        ...Object.keys(labels.urbanization),
      ]);
      for (const census of Object.keys(map)) {
        expect(validKeys.has(census), `${cc}: unknown census key "${census}"`).toBe(true);
      }
    }
  });

  it("omits ethnicity for JP/CN/BR (no fabricated ethnic→archetype mapping)", () => {
    for (const cc of ["JP", "CN", "BR"] as const) {
      const map = CENSUS_TO_ARCHETYPE[cc]!;
      for (const ethKey of Object.keys(REGION_CENSUS_LABELS[cc]!.ethnicity)) {
        expect(map[ethKey], `${cc} should not map ethnicity key "${ethKey}"`).toBeUndefined();
      }
    }
  });
});

describe("calculateDerivedTurnout", () => {
  it("averages baseline/modifier of the mapped archetypes present in the bucket", () => {
    const turnout = {
      jp_voterGroups: {
        young_urban: { baseline: 48, modifier: 2, actual: 50 },
        urban_progressive: { baseline: 68, modifier: 0, actual: 68 },
        // working_mothers absent — averaged over the 2 present
      },
    };
    const r = calculateDerivedTurnout("JP", "young", turnout);
    expect(r).toEqual({ baseline: 58, modifier: 1, actual: 59 });
  });

  it("is country-aware: reads the country's own <cc>_voterGroups bucket", () => {
    const turnout = {
      uk_voterGroups: {
        retirees: { baseline: 73, modifier: 0, actual: 73 },
        rural_traditionalists: { baseline: 71, modifier: 0, actual: 71 },
        populist_right: { baseline: 55, modifier: 0, actual: 55 },
      },
    };
    const r = calculateDerivedTurnout("UK", "senior", turnout);
    expect(r?.baseline).toBeCloseTo((73 + 71 + 55) / 3);
  });

  it("returns undefined for US (direct-turnout path), unknown keys, and missing data", () => {
    expect(calculateDerivedTurnout("US", "race", { voterGroups: {} })).toBeUndefined();
    expect(calculateDerivedTurnout("JP", "not_a_real_key", { jp_voterGroups: {} })).toBeUndefined();
    expect(calculateDerivedTurnout("JP", "young", undefined)).toBeUndefined();
    expect(calculateDerivedTurnout(undefined, "young", { jp_voterGroups: {} })).toBeUndefined();
  });

  it("returns undefined when none of the mapped archetypes are present in the bucket", () => {
    expect(calculateDerivedTurnout("JP", "young", { jp_voterGroups: {} })).toBeUndefined();
  });

  it("derives census turnout for the seceded nations off the shared UK archetype bucket", () => {
    // Regression: SCO/WAL were missing from CENSUS_TO_ARCHETYPE, so their census
    // turnout came back undefined ("—") despite sharing uk_voterGroups.
    const turnout = {
      uk_voterGroups: {
        retirees: { baseline: 73, modifier: 0, actual: 73 },
        rural_traditionalists: { baseline: 71, modifier: 0, actual: 71 },
        populist_right: { baseline: 55, modifier: 0, actual: 55 },
      },
    };
    for (const cc of ["SCO", "WAL"]) {
      expect(calculateDerivedTurnout(cc, "senior", turnout)?.baseline).toBeCloseTo(
        (73 + 71 + 55) / 3
      );
      expect(calculateDerivedTurnout(cc, "white_british", turnout)).toBeDefined();
    }
  });
});
