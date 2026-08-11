/**
 * Germany (DE) Layer-1 model — era-fact anchor tests.
 *
 * Tests encode ONLY historically defensible facts about the direction of each
 * Land's lean per era. They do NOT compare against existing seed leans.
 *
 * Anchor rationale:
 *   - Bavaria (BY) & Baden-Württemberg (BW): Catholic, affluent, Mittelstand →
 *     CDU/CSU RIGHT. Anchored in 1979 (Kohl-era opposition heartland) and
 *     2019/2023 (still the conservative south). The 1998-2002 Red-Green national
 *     landslide is intentionally NOT anchored (it briefly tilts most West Länder
 *     left, which is historically defensible, so we don't assert sign there).
 *   - City-states Berlin (BE), Hamburg (HH), Bremen (BRE): urban, secular,
 *     educated → LEFT across all eras.
 *   - Eastern Länder (SN, TH, ST, BB, MV): by 2019/2023 dominated by social-right
 *     AfD-protest signal → display lean strongly RIGHT. (Their 1979 values are
 *     DDR-era best-effort and not asserted — see de.ts caveat.)
 *
 * The harness mirrors the real game pipeline:
 *   getDeModel(era) → deriveCountryGroupLean/Populations/Turnout
 *   → StateDemographics → calculateStateLean → getDisplayLean
 */

import { describe, it, expect } from "vitest";
import { getDeModel, deLayer1Model, deGroupIds } from "./de";
import {
  deriveCountryGroupPopulations,
  deriveCountryGroupLean,
  deriveCountryGroupTurnout,
} from "./derive";
import { deDemographicCategories } from "@/lib/seeds/de/deDemographicCategories";
import { calculateStateLean, getDisplayLean } from "@/lib/utils/demographics";
import type { StateDemographics } from "@/lib/db/types";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Helper ────────────────────────────────────────────────────────────────────

function getRegionDisplayLean(region: string, era: EraId): number {
  const model = getDeModel(era);
  const censusConfig = model.census[region];
  if (!censusConfig) throw new Error(`No census for region ${region} in era ${era}`);

  const pops = deriveCountryGroupPopulations(model, censusConfig);

  const groups: StateDemographics["groups"] = {};
  for (const gid of deGroupIds) {
    const lean = deriveCountryGroupLean(model, gid, censusConfig);
    const turnout = deriveCountryGroupTurnout(model, gid);
    groups[gid] = {
      population: pops[gid] ?? 0,
      economicLean: lean.economicLean,
      socialLean: lean.socialLean,
      turnout,
    };
  }

  const demographics: StateDemographics = {
    _id: region,
    countryId: "DE",
    categoryWeights: { de_voterGroups: 100 },
    groups,
    lastUpdated: new Date(),
  };

  const { economicLean, socialLean } = calculateStateLean(demographics, deDemographicCategories);
  return getDisplayLean(economicLean, socialLean);
}

// ── Exported symbols (backwards compat) ───────────────────────────────────────

describe("DE Layer-1 exported symbols", () => {
  it("deLayer1Model exposes 2019 era model", () => {
    expect(deLayer1Model.countryId).toBe("DE");
    expect(deLayer1Model.categoryId).toBe("de_voterGroups");
    expect(deLayer1Model.dims).toContain("education");
    expect(deLayer1Model.dims).toContain("ethnicity");
  });

  it("deGroupIds contains all 12 archetypes", () => {
    expect(deGroupIds).toHaveLength(12);
    expect(deGroupIds).toContain("katholische_konservative");
    expect(deGroupIds).toContain("protest_waehler_ost");
  });

  it("deLayer1Model has census data for all 16 Länder", () => {
    const lands = [
      "BW",
      "BY",
      "NW",
      "HE",
      "RP",
      "SL",
      "NI",
      "SH",
      "HH",
      "BRE",
      "BE",
      "BB",
      "MV",
      "SN",
      "ST",
      "TH",
    ];
    for (const l of lands) {
      expect(deLayer1Model.census[l], `missing census for ${l}`).toBeDefined();
    }
  });
});

// ── 1979 (West Germany) anchors ───────────────────────────────────────────────
// Schmidt SPD chancellorship; CDU/CSU opposition under Kohl. The Catholic,
// affluent South was the conservative heartland; industrial cities and the
// city-states leaned left.

describe("1979 era anchors (West Germany)", () => {
  it("BY is right-leaning in 1979 (Catholic CSU heartland)", () => {
    expect(getRegionDisplayLean("BY", "1979")).toBeGreaterThan(0);
  });

  it("BW is right-leaning in 1979 (Catholic, affluent, Mittelstand)", () => {
    expect(getRegionDisplayLean("BW", "1979")).toBeGreaterThan(0);
  });

  it("HH is left-leaning in 1979 (urban, secular city-state)", () => {
    expect(getRegionDisplayLean("HH", "1979")).toBeLessThan(0);
  });

  it("BRE is left-leaning in 1979 (industrial port city-state, SPD)", () => {
    expect(getRegionDisplayLean("BRE", "1979")).toBeLessThan(0);
  });
});

// ── 2019 era anchors ──────────────────────────────────────────────────────────
// AfD entrenched (Bundestag 2017); education/urban cleavage dominant; eastern
// Länder dominated by social-right protest signal.

describe("2019 era anchors", () => {
  it("BY is right-leaning in 2019 (CSU south)", () => {
    expect(getRegionDisplayLean("BY", "2019")).toBeGreaterThan(0);
  });

  it("BW is right-leaning in 2019 (conservative south)", () => {
    expect(getRegionDisplayLean("BW", "2019")).toBeGreaterThan(0);
  });

  it("BE is left-leaning in 2019 (secular, diverse, educated capital)", () => {
    expect(getRegionDisplayLean("BE", "2019")).toBeLessThan(0);
  });

  it("HH is left-leaning in 2019 (urban progressive city-state)", () => {
    expect(getRegionDisplayLean("HH", "2019")).toBeLessThan(0);
  });

  it("BRE is left-leaning in 2019 (left-most German Land)", () => {
    expect(getRegionDisplayLean("BRE", "2019")).toBeLessThan(0);
  });

  it("SN is social-right in 2019 (Saxony — AfD eastern stronghold)", () => {
    expect(getRegionDisplayLean("SN", "2019")).toBeGreaterThan(0);
  });

  it("TH is social-right in 2019 (Thuringia — AfD eastern stronghold)", () => {
    expect(getRegionDisplayLean("TH", "2019")).toBeGreaterThan(0);
  });

  it("MV is social-right in 2019 (Mecklenburg-Vorpommern — eastern AfD)", () => {
    expect(getRegionDisplayLean("MV", "2019")).toBeGreaterThan(0);
  });

  it("BB is social-right in 2019 (Brandenburg — eastern AfD)", () => {
    expect(getRegionDisplayLean("BB", "2019")).toBeGreaterThan(0);
  });

  it("ST is social-right in 2019 (Saxony-Anhalt — eastern AfD)", () => {
    expect(getRegionDisplayLean("ST", "2019")).toBeGreaterThan(0);
  });
});

// ── 2023 era anchors ──────────────────────────────────────────────────────────
// Ampel era; cost-of-living; AfD polling 20%+, strongest in the East.

describe("2023 era anchors", () => {
  it("Eastern Länder are social-right in 2023 (AfD surge)", () => {
    for (const land of ["SN", "TH", "ST", "BB", "MV"]) {
      expect(getRegionDisplayLean(land, "2023"), `${land} should be right in 2023`).toBeGreaterThan(
        0
      );
    }
  });

  it("city-states remain left in 2023", () => {
    for (const land of ["BE", "HH", "BRE"]) {
      expect(getRegionDisplayLean(land, "2023"), `${land} should be left in 2023`).toBeLessThan(0);
    }
  });

  it("BY and BW remain right in 2023 (conservative south)", () => {
    expect(getRegionDisplayLean("BY", "2023")).toBeGreaterThan(0);
    expect(getRegionDisplayLean("BW", "2023")).toBeGreaterThan(0);
  });
});

// ── Realignment: East intensifies social-right 2007 → 2023 ────────────────────
// Pre-AfD (2007) the East read econ-left/mixed; post-2015 the AfD protest signal
// pushes the display lean further right. The model should reflect this drift.

describe("Eastern AfD realignment — Saxony", () => {
  it("SN is more right in 2023 than in 2007 (AfD social-right drift)", () => {
    const lean2007 = getRegionDisplayLean("SN", "2007");
    const lean2023 = getRegionDisplayLean("SN", "2023");
    expect(lean2023).toBeGreaterThan(lean2007);
  });
});

// ── Data integrity ────────────────────────────────────────────────────────────

describe("Model data integrity", () => {
  const ERAS: EraId[] = ["1979", "1991", "1999", "2007", "2019", "2023"];
  const LANDS = [
    "BW",
    "BY",
    "NW",
    "HE",
    "RP",
    "SL",
    "NI",
    "SH",
    "HH",
    "BRE",
    "BE",
    "BB",
    "MV",
    "SN",
    "ST",
    "TH",
  ];

  // 1979 is West-Germany-only (the FRG): the GDR is the separate DD country, so
  // the five eastern Länder are not part of DE in that era.
  const WEST = ["BW", "BY", "NW", "HE", "RP", "SL", "NI", "SH", "HH", "BRE", "BE"];
  const landsForEra = (era: EraId) => (era === "1979" ? WEST : LANDS);

  for (const era of ERAS) {
    it(`${era}: every Land has census data`, () => {
      const model = getDeModel(era);
      for (const l of landsForEra(era)) {
        expect(model.census[l], `${era} missing ${l}`).toBeDefined();
      }
    });

    it(`${era}: census dim totals ≈ 100 for each Land`, () => {
      const model = getDeModel(era);
      const DIMS = ["ethnicity", "age", "education", "income", "urbanization"];
      for (const l of landsForEra(era)) {
        for (const dim of DIMS) {
          const vals = Object.values(model.census[l]?.[dim] ?? {});
          const sum = vals.reduce((a: number, b) => a + (b as number), 0);
          expect(sum, `${era} ${l}.${dim} sums to ${sum}`).toBeGreaterThan(98);
          expect(sum, `${era} ${l}.${dim} sums to ${sum}`).toBeLessThan(102);
        }
      }
    });
  }

  it("composition weights are all positive and non-zero", () => {
    const model = getDeModel("2019");
    for (const [gid, comp] of Object.entries(model.composition)) {
      for (const entry of comp.weights) {
        expect(entry.w, `${gid} has zero/negative weight`).toBeGreaterThan(0);
      }
    }
  });

  it("all 12 group compositions reference valid dims", () => {
    const model = getDeModel("2019");
    const validDims = new Set(model.dims);
    for (const [gid, comp] of Object.entries(model.composition)) {
      for (const { dim } of comp.weights) {
        expect(validDims.has(dim), `${gid} references unknown dim "${dim}"`).toBe(true);
      }
    }
  });
});
