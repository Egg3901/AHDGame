/**
 * Brazil Layer-1 model — era-fact anchor tests.
 *
 * Tests ONLY encode historically defensible facts about regional leans.
 * They do NOT compare to existing seed leans.
 *
 * Anchor rationale:
 *   1999: NORDESTE emerging PT base (economic left); SUL = PSDB/right of centre
 *   2007: NORDESTE strongly economic left (Bolsa Família epicentre, Lula won 72%
 *         there); CENTRO_OESTE = economic right (agribusiness boom)
 *   2019: NORDESTE economic left (Haddad ~72.6% 2nd round);
 *         SUL economic + social right (Bolsonaro ~76%);
 *         CENTRO_OESTE economic right (Bolsonaro ~73%)
 *   2023: NORDESTE left; SUL right (mirrors 2022 result: Lula 72% vs Bolsonaro 24%
 *         in Nordeste; Bolsonaro 63% vs Lula 36% in Sul)
 *
 * 1979 anchors are kept light: Brazil was under military dictatorship; no
 * competitive presidential elections occurred until 1989. Only directional
 * attitudinal signals are asserted (no strong left/right claims), and we only
 * assert that the model differs from the 2019 era in sensible ways.
 *
 * The test harness mirrors the real game pipeline:
 *   getBrModel(era) → deriveCountryGroupPopulations / deriveCountryGroupLean
 *   → StateDemographics → calculateStateLean → getDisplayLean
 */

import { describe, it, expect } from "vitest";
import { getBrModel, brLayer1Model, brGroupIds } from "./br";
import {
  deriveCountryGroupPopulations,
  deriveCountryGroupLean,
  deriveCountryGroupTurnout,
} from "./derive";
import { brDemographicCategories } from "@/lib/seeds/br/brDemographicCategories";
import { calculateStateLean, getDisplayLean } from "@/lib/utils/demographics";
import type { StateDemographics } from "@/lib/db/types";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Helper ─────────────────────────────────────────────────────────────────────

function getRegionDisplayLean(region: string, era: EraId): number {
  const model = getBrModel(era);
  const censusConfig = model.census[region];
  if (!censusConfig) throw new Error(`No census for region ${region} in era ${era}`);

  const pops = deriveCountryGroupPopulations(model, censusConfig);

  const groups: StateDemographics["groups"] = {};
  for (const gid of brGroupIds) {
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
    countryId: "BR",
    categoryWeights: { br_voterGroups: 100 },
    groups,
    lastUpdated: new Date(),
  };

  const { economicLean, socialLean } = calculateStateLean(demographics, brDemographicCategories);
  return getDisplayLean(economicLean, socialLean);
}

// ── Backwards-compatibility exports ───────────────────────────────────────────

describe("BR Layer-1 exported symbols (backwards compat)", () => {
  it("brLayer1Model exposes 2019 era model", () => {
    expect(brLayer1Model.countryId).toBe("BR");
    expect(brLayer1Model.categoryId).toBe("br_voterGroups");
    expect(brLayer1Model.dims).toContain("education");
    expect(brLayer1Model.dims).toContain("ethnicity");
  });

  it("brGroupIds contains all 8 archetypes", () => {
    expect(brGroupIds).toHaveLength(8);
    expect(brGroupIds).toContain("working_class_pt");
    expect(brGroupIds).toContain("evangelical_conservative");
  });

  it("brLayer1Model has census data for all 5 macro-regions", () => {
    const regions = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"];
    for (const r of regions) {
      expect(brLayer1Model.census[r], `missing census for ${r}`).toBeDefined();
    }
  });
});

// ── Data integrity ─────────────────────────────────────────────────────────────

describe("Model data integrity", () => {
  const ERAS: EraId[] = ["1979", "1991", "1999", "2007", "2019", "2023"];
  const REGIONS = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"];
  const DIMS = ["ethnicity", "age", "education", "income", "urbanization"];

  for (const era of ERAS) {
    it(`${era}: all 5 regions have census data`, () => {
      const model = getBrModel(era);
      for (const r of REGIONS) {
        expect(model.census[r], `${era} missing ${r}`).toBeDefined();
      }
    });

    it(`${era}: census dim totals ≈ 100 for each region`, () => {
      const model = getBrModel(era);
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

  it("composition weights are all positive", () => {
    const model = getBrModel("2019");
    for (const [gid, comp] of Object.entries(model.composition)) {
      for (const entry of comp.weights) {
        expect(entry.w, `${gid} has zero/negative weight`).toBeGreaterThan(0);
      }
    }
  });

  it("all 8 group compositions reference valid dims", () => {
    const model = getBrModel("2019");
    const validDims = new Set(model.dims);
    for (const [gid, comp] of Object.entries(model.composition)) {
      for (const { dim } of comp.weights) {
        expect(validDims.has(dim), `${gid} references unknown dim "${dim}"`).toBe(true);
      }
    }
  });
});

// ── 1999 era anchors ───────────────────────────────────────────────────────────
// Nascent PT base in NORDESTE; PSDB-leaning centre-right in SUL.
// Not a strong cleavage yet — anchors are modest.

describe("1999 era anchors", () => {
  it("NORDESTE leans more economic-left than SUL in 1999 (nascent PT base)", () => {
    const nordeste = getRegionDisplayLean("NORDESTE", "1999");
    const sul = getRegionDisplayLean("SUL", "1999");
    expect(nordeste).toBeLessThan(sul);
  });
});

// ── 2007 era anchors ───────────────────────────────────────────────────────────
// Lula won 2006 with 61% (2nd round), 72% in Nordeste. Bolsa Família in full swing.
// CENTRO_OESTE agroboom = economic right.

describe("2007 era anchors", () => {
  it("NORDESTE is economically left in 2007 (Bolsa Família / Lula peak)", () => {
    const lean = getRegionDisplayLean("NORDESTE", "2007");
    expect(lean).toBeLessThan(0);
  });

  it("NORDESTE is more economic-left than CENTRO_OESTE in 2007", () => {
    const nordeste = getRegionDisplayLean("NORDESTE", "2007");
    const centroOeste = getRegionDisplayLean("CENTRO_OESTE", "2007");
    expect(nordeste).toBeLessThan(centroOeste);
  });
});

// ── 2019 era anchors ───────────────────────────────────────────────────────────
// Bolsonaro realignment. TSE 2018 2nd round results:
//   Nordeste: Haddad 72.6%, Bolsonaro 27.4% → strongly left
//   Sul:      Bolsonaro 76.4%, Haddad 23.6% → strongly right
//   Centro-Oeste: Bolsonaro 73.0%, Haddad 27.0% → strongly right
//   Sudeste: Bolsonaro 56.9%, Haddad 43.1% → right-leaning (but mixed)

describe("2019 era anchors", () => {
  it("NORDESTE is economically left in 2019 (Haddad 72.6% in 2nd round)", () => {
    const lean = getRegionDisplayLean("NORDESTE", "2019");
    expect(lean).toBeLessThan(0);
  });

  it("SUL is economically right in 2019 (Bolsonaro 76.4% in 2nd round)", () => {
    const lean = getRegionDisplayLean("SUL", "2019");
    expect(lean).toBeGreaterThan(0);
  });

  it("CENTRO_OESTE is economically right in 2019 (Bolsonaro 73% in 2nd round)", () => {
    const lean = getRegionDisplayLean("CENTRO_OESTE", "2019");
    expect(lean).toBeGreaterThan(0);
  });

  it("NORDESTE is significantly more economic-left than SUL in 2019", () => {
    const nordeste = getRegionDisplayLean("NORDESTE", "2019");
    const sul = getRegionDisplayLean("SUL", "2019");
    // Expect a meaningful gap — 0.5 points on the display lean scale.
    // The actual 2018 2nd-round split was ~50 percentage points (Haddad 72.6% vs
    // Bolsonaro 76.4%), the largest regional divide in Brazilian electoral history.
    expect(nordeste).toBeLessThan(sul - 0.5);
  });
});

// ── 2023 era anchors ───────────────────────────────────────────────────────────
// 2022 2nd round: Lula 72.3% / Bolsonaro 24.4% in Nordeste;
//                 Lula 36.1% / Bolsonaro 63.9% in Sul.

describe("2023 era anchors", () => {
  it("NORDESTE is economically left in 2023 (Lula 72% in 2022)", () => {
    const lean = getRegionDisplayLean("NORDESTE", "2023");
    expect(lean).toBeLessThan(0);
  });

  it("SUL is economically right in 2023 (Bolsonaro 64% in 2022)", () => {
    const lean = getRegionDisplayLean("SUL", "2023");
    expect(lean).toBeGreaterThan(0);
  });

  it("NORDESTE is more left in 2023 than SUL", () => {
    const nordeste = getRegionDisplayLean("NORDESTE", "2023");
    const sul = getRegionDisplayLean("SUL", "2023");
    expect(nordeste).toBeLessThan(sul);
  });
});

// ── Longitudinal: NORDESTE left-consolidation 1999 → 2019 ─────────────────────
// The Nordeste was the least developed PT region in 1999 (Lula lost 1998).
// By 2007 and 2019, it became the most reliably PT/left region in Brazil.
// The model should show this consolidation.

describe("NORDESTE left-consolidation over time", () => {
  it("NORDESTE is more left in 2007 than in 1999 (PT consolidation)", () => {
    const lean1999 = getRegionDisplayLean("NORDESTE", "1999");
    const lean2007 = getRegionDisplayLean("NORDESTE", "2007");
    expect(lean2007).toBeLessThanOrEqual(lean1999);
  });

  it("NORDESTE is more left (or equal) in 2019 than in 1991 (long-run PT alignment)", () => {
    const lean1991 = getRegionDisplayLean("NORDESTE", "1991");
    const lean2019 = getRegionDisplayLean("NORDESTE", "2019");
    expect(lean2019).toBeLessThanOrEqual(lean1991);
  });
});

// ── 1979 lite anchors ──────────────────────────────────────────────────────────
// Military dictatorship: no direct presidential elections. These anchors are
// deliberately light — we only assert structural differences, not strong directional
// leans. We don't assert absolute left/right for any region in 1979.

describe("1979 era — structural checks only (dictatorship era)", () => {
  it("1979 SUL is less social-conservative than 2019 (Bolsonaro era not yet)", () => {
    // Social lean of SUL should be lower (less right-conservative) in 1979 than 2019
    // because the Bolsonaro evangelical+authoritarian coalition didn't exist yet.
    const model1979 = getBrModel("1979");
    const model2019 = getBrModel("2019");
    const config1979 = model1979.census["SUL"];
    const config2019 = model2019.census["SUL"];

    const groups1979: StateDemographics["groups"] = {};
    const groups2019: StateDemographics["groups"] = {};

    for (const gid of brGroupIds) {
      const lean1979 = deriveCountryGroupLean(model1979, gid, config1979);
      groups1979[gid] = {
        population: 10,
        economicLean: lean1979.economicLean,
        socialLean: lean1979.socialLean,
        turnout: 75,
      };
      const lean2019 = deriveCountryGroupLean(model2019, gid, config2019);
      groups2019[gid] = {
        population: 10,
        economicLean: lean2019.economicLean,
        socialLean: lean2019.socialLean,
        turnout: 75,
      };
    }

    const dem1979: StateDemographics = {
      _id: "SUL",
      countryId: "BR",
      categoryWeights: { br_voterGroups: 100 },
      groups: groups1979,
      lastUpdated: new Date(),
    };
    const dem2019: StateDemographics = {
      _id: "SUL",
      countryId: "BR",
      categoryWeights: { br_voterGroups: 100 },
      groups: groups2019,
      lastUpdated: new Date(),
    };

    const { socialLean: s1979 } = calculateStateLean(dem1979, brDemographicCategories);
    const { socialLean: s2019 } = calculateStateLean(dem2019, brDemographicCategories);

    // SUL should be less socially conservative (lower social lean) in 1979 vs 2019
    expect(s1979).toBeLessThanOrEqual(s2019);
  });

  it("1979 model covers all 5 macro-regions", () => {
    const model = getBrModel("1979");
    const regions = ["NORTE", "NORDESTE", "CENTRO_OESTE", "SUDESTE", "SUL"];
    for (const r of regions) {
      expect(model.census[r]).toBeDefined();
    }
  });
});
