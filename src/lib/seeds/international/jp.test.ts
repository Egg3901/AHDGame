/**
 * JP Layer-1 model — era-fact anchor tests.
 *
 * Tests ONLY encode historically defensible facts about the direction of
 * regional leans in each era. They do NOT compare to the old seed leans.
 *
 * Anchor rationale:
 *   1979: LDP dominance at peak — rural regions (TOH, SHI, CGK) are strongly
 *         RIGHT (agricultural subsidy + koenkai networks). KAN (Tokyo metro) has
 *         the most urbanised + young profile; urban industrial workers lean left.
 *   2019: Abe era. Rural / senior lock: TOH, SHI strongly RIGHT. KAN (Tokyo) and
 *         KNS (Osaka/Kyoto) are Japan's most LEFT-leaning regions vs the rest,
 *         driven by university graduates + urban progressive population.
 *   Opposition surges:
 *     1993 (reflected in 1991 positions): urban positions shift left relative to 1979.
 *     2009 (reflected in 2007 positions): DPJ wave — urban young/educated most left.
 *   Aging electorate: senior weight increases over time (rural regions most affected).
 *
 * The test harness mirrors the real game pipeline:
 *   getJpModel(era) → deriveCountryGroupLean/Populations/Turnout
 *   → StateDemographics → calculateStateLean → getDisplayLean
 */

import { describe, it, expect } from "vitest";
import { getJpModel, jpLayer1Model, jpGroupIds } from "./jp";
import {
  deriveCountryGroupPopulations,
  deriveCountryGroupLean,
  deriveCountryGroupTurnout,
} from "./derive";
import { jpDemographicCategories } from "@/lib/seeds/jp/jpDemographicCategories";
import { calculateStateLean, getDisplayLean } from "@/lib/utils/demographics";
import type { StateDemographics } from "@/lib/db/types";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Helper ────────────────────────────────────────────────────────────────────

function getRegionDisplayLean(region: string, era: EraId): number {
  const model = getJpModel(era);
  const censusConfig = model.census[region];
  if (!censusConfig) throw new Error(`No census for region ${region} in era ${era}`);

  const pops = deriveCountryGroupPopulations(model, censusConfig);

  const groups: StateDemographics["groups"] = {};
  for (const gid of jpGroupIds) {
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
    countryId: "JP",
    categoryWeights: { jp_voterGroups: 100 },
    groups,
    lastUpdated: new Date(),
  };

  const { economicLean, socialLean } = calculateStateLean(demographics, jpDemographicCategories);
  return getDisplayLean(economicLean, socialLean);
}

// ── Backwards-compatibility: exported symbols ─────────────────────────────────

describe("JP Layer-1 exported symbols (backwards compat)", () => {
  it("jpLayer1Model exposes 2019 era model", () => {
    expect(jpLayer1Model.countryId).toBe("JP");
    expect(jpLayer1Model.categoryId).toBe("jp_voterGroups");
    expect(jpLayer1Model.dims).toContain("education");
    expect(jpLayer1Model.dims).toContain("ethnicity");
  });

  it("jpGroupIds contains all 10 archetypes", () => {
    expect(jpGroupIds).toHaveLength(10);
    expect(jpGroupIds).toContain("salaryman_conservative");
    expect(jpGroupIds).toContain("working_mothers");
  });

  it("jpLayer1Model has census data for all 8 regions", () => {
    const regions = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"];
    for (const r of regions) {
      expect(jpLayer1Model.census[r], `missing census for ${r}`).toBeDefined();
    }
  });
});

// ── 1979 era anchors ──────────────────────────────────────────────────────────
// Facts: The 1955 system was fully intact. LDP won landslide after landslide.
// Rural regions (Tohoku, Shikoku, Chugoku) were LDP strongholds via agricultural
// subsidies and koenkai networks. Urban industrial workers (Kanto, Kansai) had
// JSP union base but LDP still won national majorities.

describe("1979 era anchors", () => {
  it("TOH is right-leaning in 1979 (rural LDP stronghold, high senior %)", () => {
    const lean = getRegionDisplayLean("TOH", "1979");
    expect(lean).toBeGreaterThan(0);
  });

  it("SHI is right-leaning in 1979 (most rural/agricultural island)", () => {
    const lean = getRegionDisplayLean("SHI", "1979");
    expect(lean).toBeGreaterThan(0);
  });

  it("CGK is right-leaning in 1979 (rural Sanin coast, industrial LDP Sanyo)", () => {
    const lean = getRegionDisplayLean("CGK", "1979");
    expect(lean).toBeGreaterThan(0);
  });

  it("KAN is less right than TOH in 1979 (Tokyo urban industrial base)", () => {
    const kanLean = getRegionDisplayLean("KAN", "1979");
    const tohLean = getRegionDisplayLean("TOH", "1979");
    // Kanto (Tokyo) should be less right-leaning than Tohoku (deep rural)
    expect(kanLean).toBeLessThan(tohLean);
  });
});

// ── 2019 era anchors ──────────────────────────────────────────────────────────
// Facts: Abe era. Rural/senior lock maintained. Education becomes stronger predictor.
// Kanto (68% urban, 45% university) leans most progressive. Shikoku (42% rural,
// 37% senior) and Tohoku (40% rural, 35% senior) are most right-leaning.

describe("2019 era anchors", () => {
  it("TOH is right-leaning in 2019 (oldest, most rural region)", () => {
    const lean = getRegionDisplayLean("TOH", "2019");
    expect(lean).toBeGreaterThan(0);
  });

  it("SHI is right-leaning in 2019 (rural, aging, high HS rate)", () => {
    const lean = getRegionDisplayLean("SHI", "2019");
    expect(lean).toBeGreaterThan(0);
  });

  it("KAN is left of TOH in 2019 (Tokyo: high degree%, urban, diverse)", () => {
    const kanLean = getRegionDisplayLean("KAN", "2019");
    const tohLean = getRegionDisplayLean("TOH", "2019");
    expect(kanLean).toBeLessThan(tohLean);
  });

  it("KAN is left of SHI in 2019 (Tokyo vs rural Shikoku)", () => {
    const kanLean = getRegionDisplayLean("KAN", "2019");
    const shiLean = getRegionDisplayLean("SHI", "2019");
    expect(kanLean).toBeLessThan(shiLean);
  });

  it("KNS is left of SHI in 2019 (Osaka metro: urban, university vs rural Shikoku)", () => {
    // KNS (Osaka/Kyoto: urban=60%, university=42%) vs SHI (rural=42%, senior=37%)
    // Shikoku is Japan's most rural, most aged region — solidly LDP-right.
    // Kansai (Ishin/CDP) should be less right than Shikoku.
    const knsLean = getRegionDisplayLean("KNS", "2019");
    const shiLean = getRegionDisplayLean("SHI", "2019");
    expect(knsLean).toBeLessThan(shiLean);
  });
});

// ── Opposition surge: 1979 → 1991 urban left shift ────────────────────────────
// The 1993 coalition (Hosokawa), which broke LDP dominance for the first time,
// drew from urban, younger, educated voters angry over LDP corruption.
// The 1991 era positions should reflect this urban left surge.

describe("1993 opposition surge (1991 era) — urban left shift", () => {
  it("KAN urban positions more left in 1991 than 1979 (anti-LDP surge)", () => {
    const lean1979 = getRegionDisplayLean("KAN", "1979");
    const lean1991 = getRegionDisplayLean("KAN", "1991");
    // Urban KAN should be MORE left (or less right) in 1991 era than 1979
    expect(lean1991).toBeLessThanOrEqual(lean1979);
  });

  it("TOH rural maintains right lean in 1991 (rural LDP lock persists)", () => {
    const lean = getRegionDisplayLean("TOH", "1991");
    expect(lean).toBeGreaterThan(0);
  });
});

// ── DPJ surge: 2009 reflected in 2007 era positions ──────────────────────────
// The 2009 DPJ landslide (historic opposition victory) reflected growing urban
// frustration. The 2007 era positions capture the approaching wave.

describe("2009 DPJ surge (2007 era) — urban progressive peak", () => {
  it("KAN is more left in 2007 than in 2019 (DPJ wave vs Abe consolidation)", () => {
    const lean2007 = getRegionDisplayLean("KAN", "2007");
    const lean2019 = getRegionDisplayLean("KAN", "2019");
    expect(lean2007).toBeLessThanOrEqual(lean2019);
  });
});

// ── Aging electorate: senior weight grows over time ───────────────────────────
// Rural regions (TOH, SHI) age fastest. Senior % in TOH: 18% (1979) → 38% (2023).
// Since seniors have right/traditional lean, rural regions should be at least
// as right in later eras as early eras.

describe("Aging electorate — rural right lean persists/deepens", () => {
  it("TOH senior % is higher in 2023 than 1979 (aging electorate)", () => {
    const model1979 = getJpModel("1979");
    const model2023 = getJpModel("2023");
    const senior1979 = model1979.census["TOH"]["age"]["senior"];
    const senior2023 = model2023.census["TOH"]["age"]["senior"];
    expect(senior2023).toBeGreaterThan(senior1979);
  });

  it("SHI senior % is higher in 2023 than 1979 (fastest-aging region)", () => {
    const model1979 = getJpModel("1979");
    const model2023 = getJpModel("2023");
    const senior1979 = model1979.census["SHI"]["age"]["senior"];
    const senior2023 = model2023.census["SHI"]["age"]["senior"];
    expect(senior2023).toBeGreaterThan(senior1979);
  });
});

// ── Data integrity ────────────────────────────────────────────────────────────

describe("Model data integrity", () => {
  const ERAS: EraId[] = ["1979", "1991", "1999", "2007", "2019", "2023"];
  const REGIONS = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"];

  for (const era of ERAS) {
    it(`${era}: all 8 regions have census data`, () => {
      const model = getJpModel(era);
      for (const r of REGIONS) {
        expect(model.census[r], `${era} missing ${r}`).toBeDefined();
      }
    });

    it(`${era}: census dim totals ≈ 100 for each region`, () => {
      const model = getJpModel(era);
      const DIMS = ["ethnicity", "age", "education", "income", "urbanization"];
      for (const r of REGIONS) {
        for (const dim of DIMS) {
          const vals = Object.values(model.census[r]?.[dim] ?? {});
          const sum = vals.reduce((a: number, b) => a + (b as number), 0);
          expect(sum, `${era} ${r}.${dim} sums to ${sum}`).toBeGreaterThan(98);
          expect(sum, `${era} ${r}.${dim} sums to ${sum}`).toBeLessThan(102);
        }
      }
    });
  }

  it("composition weights are all positive and non-zero", () => {
    const model = getJpModel("2019");
    for (const [gid, comp] of Object.entries(model.composition)) {
      for (const entry of comp.weights) {
        expect(entry.w, `${gid} has zero/negative weight`).toBeGreaterThan(0);
      }
    }
  });

  it("all 10 group compositions reference valid dims", () => {
    const model = getJpModel("2019");
    const validDims = new Set(model.dims);
    for (const [gid, comp] of Object.entries(model.composition)) {
      for (const { dim } of comp.weights) {
        expect(validDims.has(dim), `${gid} references unknown dim "${dim}"`).toBe(true);
      }
    }
  });
});
