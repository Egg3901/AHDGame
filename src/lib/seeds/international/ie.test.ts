/**
 * Ireland Layer-1 model — era-fact anchor tests.
 *
 * Tests ONLY encode historically defensible facts about the direction of
 * regional leans. They do NOT compare to existing seed leans.
 *
 * Anchor rationale:
 *   1979: Near-universal Catholic observance; divorce, contraception, and
 *         abortion all banned. All regions socially traditional (positive
 *         social lean). Dublin slightly less traditional than rural west.
 *
 *   2019: Marriage equality referendum (May 2015): 62% Yes nationally;
 *         Dublin ~80% Yes. Abortion repeal (May 2018): 66% Yes nationally.
 *         Dublin (urban, graduate-heavy) should be strongly socially liberal.
 *         GAL and DON (rural, lower education, older) more traditional.
 *         Overall social axis must have liberalised 1979→2019 in every region.
 *
 *   Economic: Post-crash 2019 Ireland moved economically left (SF surge,
 *         housing crisis). Dublin in 2019 leans more left than in 2007 (Tiger peak).
 *
 * The test harness mirrors the real game pipeline:
 *   getIeModel(era) → deriveCountryGroupLean/Populations/Turnout
 *   → StateDemographics → calculateStateLean → getDisplayLean
 */

import { describe, it, expect } from "vitest";
import { getIeModel, ieLayer1Model, ieGroupIds } from "./ie";
import {
  deriveCountryGroupPopulations,
  deriveCountryGroupLean,
  deriveCountryGroupTurnout,
} from "./derive";
import { ieDemographicCategories } from "@/lib/seeds/ie/ieDemographicCategories";
import { calculateStateLean } from "@/lib/utils/demographics";
import type { StateDemographics } from "@/lib/db/types";
import type { EraId } from "@/lib/seeds/presetSelector";

// ── Helper ────────────────────────────────────────────────────────────────────

function getRegionSocialLean(region: string, era: EraId): number {
  const model = getIeModel(era);
  const censusConfig = model.census[region];
  if (!censusConfig) throw new Error(`No census for region ${region} in era ${era}`);

  const pops = deriveCountryGroupPopulations(model, censusConfig);

  const groups: StateDemographics["groups"] = {};
  for (const gid of ieGroupIds) {
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
    countryId: "IE",
    categoryWeights: { ie_voterGroups: 100 },
    groups,
    lastUpdated: new Date(),
  };

  const { socialLean } = calculateStateLean(demographics, ieDemographicCategories);
  return socialLean;
}

function getRegionEconomicLean(region: string, era: EraId): number {
  const model = getIeModel(era);
  const censusConfig = model.census[region];
  if (!censusConfig) throw new Error(`No census for region ${region} in era ${era}`);

  const pops = deriveCountryGroupPopulations(model, censusConfig);

  const groups: StateDemographics["groups"] = {};
  for (const gid of ieGroupIds) {
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
    countryId: "IE",
    categoryWeights: { ie_voterGroups: 100 },
    groups,
    lastUpdated: new Date(),
  };

  const { economicLean } = calculateStateLean(demographics, ieDemographicCategories);
  return economicLean;
}

// ── Backwards-compatibility: exported symbols ─────────────────────────────────

describe("IE Layer-1 exported symbols", () => {
  it("ieLayer1Model exposes 2019 era model", () => {
    expect(ieLayer1Model.countryId).toBe("IE");
    expect(ieLayer1Model.categoryId).toBe("ie_voterGroups");
    expect(ieLayer1Model.dims).toContain("education");
    expect(ieLayer1Model.dims).toContain("ethnicity");
  });

  it("ieGroupIds contains all 8 archetypes", () => {
    expect(ieGroupIds).toHaveLength(8);
    expect(ieGroupIds).toContain("urban_professional");
    expect(ieGroupIds).toContain("border_communities");
  });

  it("ieLayer1Model has census data for all 8 regions", () => {
    const regions = ["DUB", "KIL", "MID", "LIM", "COR", "WEX", "GAL", "DON"];
    for (const r of regions) {
      expect(ieLayer1Model.census[r], `missing census for ${r}`).toBeDefined();
    }
  });
});

// ── 1979 social conservatism anchors ─────────────────────────────────────────
// 1979 Ireland: near-universal Catholicism; all regions should be socially
// traditional (positive social lean). The rural west should be more traditional
// than Dublin.

describe("1979 social conservatism", () => {
  it("DUB is socially traditional in 1979 (Catholic consensus everywhere)", () => {
    const s = getRegionSocialLean("DUB", "1979");
    expect(s).toBeGreaterThan(0);
  });

  it("GAL (rural west) is socially more traditional than DUB in 1979", () => {
    const dubSocial = getRegionSocialLean("DUB", "1979");
    const galSocial = getRegionSocialLean("GAL", "1979");
    expect(galSocial).toBeGreaterThan(dubSocial);
  });

  it("DON (border, most rural) is socially traditional in 1979", () => {
    const s = getRegionSocialLean("DON", "1979");
    expect(s).toBeGreaterThan(0);
  });

  it("MID (midlands, rural) is socially more traditional than DUB in 1979", () => {
    const dubSocial = getRegionSocialLean("DUB", "1979");
    const midSocial = getRegionSocialLean("MID", "1979");
    expect(midSocial).toBeGreaterThan(dubSocial);
  });
});

// ── 2019 social liberalisation anchors ───────────────────────────────────────
// 2019: Marriage equality (2015) and abortion repeal (2018) both passed with
// large majorities. Dublin voted ~80% Yes on both. Rural areas still more
// traditional but moved dramatically from 1979.

describe("2019 social liberalisation", () => {
  it("DUB is socially progressive (liberal) in 2019 — marriage equality epicentre", () => {
    const s = getRegionSocialLean("DUB", "2019");
    expect(s).toBeLessThan(0);
  });

  it("GAL (rural west) is less socially liberal than DUB in 2019", () => {
    const dubSocial = getRegionSocialLean("DUB", "2019");
    const galSocial = getRegionSocialLean("GAL", "2019");
    // GAL should be higher (more traditional) than DUB
    expect(galSocial).toBeGreaterThan(dubSocial);
  });

  it("DON (most rural, border) is less socially liberal than DUB in 2019", () => {
    const dubSocial = getRegionSocialLean("DUB", "2019");
    const donSocial = getRegionSocialLean("DON", "2019");
    expect(donSocial).toBeGreaterThan(dubSocial);
  });

  it("COR (second city, high graduate share) is socially liberal in 2019", () => {
    const s = getRegionSocialLean("COR", "2019");
    expect(s).toBeLessThan(0);
  });
});

// ── Social axis liberalisation 1979 → 2019 ───────────────────────────────────
// Every region must become more socially liberal (lower social lean number)
// between 1979 and 2019, reflecting the documented transformation of Ireland.

describe("Social liberalisation 1979→2019", () => {
  const regions = ["DUB", "KIL", "MID", "WEX", "LIM", "COR", "GAL", "DON"];

  for (const region of regions) {
    it(`${region} is more socially liberal in 2019 than 1979`, () => {
      const s1979 = getRegionSocialLean(region, "1979");
      const s2019 = getRegionSocialLean(region, "2019");
      expect(s2019, `${region}: 1979=${s1979} 2019=${s2019}`).toBeLessThan(s1979);
    });
  }
});

// ── Economic axis anchors ─────────────────────────────────────────────────────
// 2007 Tiger peak: Ireland was pro-market. 2019 post-crash: economic left surge
// (SF, housing crisis). DUB should be more economically left in 2019 than 2007.

describe("Economic axis: post-crash left shift", () => {
  it("DUB is more economically left in 2019 than in 2007 (Tiger peak → crash fallout)", () => {
    const e2007 = getRegionEconomicLean("DUB", "2007");
    const e2019 = getRegionEconomicLean("DUB", "2019");
    expect(e2019).toBeLessThan(e2007);
  });

  it("DON is economically right of DUB in 2019 (rural FF/FG/independent base vs SF urban surge)", () => {
    // DON is poor but rural — its low-income left pull is offset by the
    // farm-owning/independent right; the SF surge was an URBAN phenomenon.
    const don = getRegionEconomicLean("DON", "2019");
    const dub = getRegionEconomicLean("DUB", "2019");
    expect(don).toBeGreaterThan(dub);
    expect(dub).toBeLessThan(0);
  });
});

// ── Data integrity ────────────────────────────────────────────────────────────

describe("Model data integrity", () => {
  const ERAS: EraId[] = ["1979", "1991", "1999", "2007", "2019", "2023"];
  const REGIONS = ["DUB", "KIL", "MID", "LIM", "COR", "WEX", "GAL", "DON"];

  for (const era of ERAS) {
    it(`${era}: all 8 regions have census data`, () => {
      const model = getIeModel(era);
      for (const r of REGIONS) {
        expect(model.census[r], `${era} missing ${r}`).toBeDefined();
      }
    });

    it(`${era}: census dim totals ≈ 100 for each region`, () => {
      const model = getIeModel(era);
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
    const model = getIeModel("2019");
    for (const [gid, comp] of Object.entries(model.composition)) {
      for (const entry of comp.weights) {
        expect(entry.w, `${gid} has zero/negative weight`).toBeGreaterThan(0);
      }
    }
  });

  it("all 8 group compositions reference valid dims", () => {
    const model = getIeModel("2019");
    const validDims = new Set(model.dims);
    for (const [gid, comp] of Object.entries(model.composition)) {
      for (const { dim } of comp.weights) {
        expect(validDims.has(dim), `${gid} references unknown dim "${dim}"`).toBe(true);
      }
    }
  });
});
