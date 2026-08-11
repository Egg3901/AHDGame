/**
 * cn.test.ts — era-anchor tests for the China Layer-1 demographic model.
 *
 * All assertions use derive functions to compute emergent leans from
 * census × positions. Nothing is tested against hand-calibrated seed values.
 *
 * Validated anchors:
 *   1979: All regions lean state-control (econ lean < 0); near-zero market-reform
 *   2019: Coastal (HD, HN, HB) more market-reform than interior (XN, XB)
 *   2019: Overall market-reform lean higher than 1979 overall
 *   2019: HD (East) is most market-reform
 *   2019: XN (Southwest) more rural/traditional → more state-control than HD
 *   Era arc: HD econ lean rises 1979 → 2007, retreats slightly 2019 → 2023 (Xi)
 */

import { describe, it, expect } from "vitest";
import { getCnModel, CN_GROUP_IDS } from "./cn";
import { deriveCountryGroupLean } from "./derive";

// ── Helper: mean econ lean across all groups for a given region ───────────────
function regionMeanEconLean(
  era: "1979" | "1991" | "1999" | "2007" | "2019" | "2023",
  regionId: string
): number {
  const model = getCnModel(era);
  const config = model.census[regionId];
  if (!config) throw new Error(`Unknown region: ${regionId}`);
  const leans = CN_GROUP_IDS.map((gid) => deriveCountryGroupLean(model, gid, config).economicLean);
  return leans.reduce((a, b) => a + b, 0) / leans.length;
}

// Helper: overall national mean (average across all 7 regions)
function nationalMeanEconLean(era: "1979" | "1991" | "1999" | "2007" | "2019" | "2023"): number {
  const regions = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
  const means = regions.map((r) => regionMeanEconLean(era, r));
  return means.reduce((a, b) => a + b, 0) / means.length;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getCnModel — model structure", () => {
  it("returns a valid CountryLayer1Model for each era", () => {
    const eras = ["1979", "1991", "1999", "2007", "2019", "2023"] as const;
    for (const era of eras) {
      const model = getCnModel(era);
      expect(model.countryId).toBe("CN");
      expect(model.categoryId).toBe("cn_voterGroups");
      expect(model.groupIds).toEqual([...CN_GROUP_IDS]);
      expect(model.dims).toEqual(["ethnicity", "age", "education", "income", "urbanization"]);
    }
  });

  it("census contains exactly 7 regions for each era", () => {
    const eras = ["1979", "1991", "1999", "2007", "2019", "2023"] as const;
    const expectedRegions = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
    for (const era of eras) {
      const model = getCnModel(era);
      const regionIds = Object.keys(model.census).sort();
      expect(regionIds).toEqual(expectedRegions.sort());
    }
  });

  it("all composition entries reference valid dims and keys", () => {
    const model = getCnModel("2019");
    for (const gid of model.groupIds) {
      const comp = model.composition[gid];
      expect(comp).toBeDefined();
      for (const { dim, key } of comp!.weights) {
        expect(model.dims).toContain(dim);
        // key must exist in at least one region's census data
        const found = Object.values(model.census).some((r) => key in r[dim]!);
        expect(found).toBe(true);
      }
    }
  });
});

describe("getCnModel — 1979 era anchors (command economy)", () => {
  it("all 7 regions have negative (state-control) mean econ lean in 1979", () => {
    const regions = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
    for (const r of regions) {
      const lean = regionMeanEconLean("1979", r);
      expect(lean, `${r} 1979 econ lean should be < 0 (state-control era)`).toBeLessThan(0);
    }
  });

  it("1979 national mean econ lean is well below 0", () => {
    const mean = nationalMeanEconLean("1979");
    expect(mean).toBeLessThan(-0.5);
  });

  it("1979 coastal (HD) and interior (XN, HZ) are close — command economy compressed regional differences", () => {
    const xn1979 = regionMeanEconLean("1979", "XN");
    const hz1979 = regionMeanEconLean("1979", "HZ");
    const hd1979 = regionMeanEconLean("1979", "HD");
    // In the command economy era all regions converge; coastal doesn't significantly
    // diverge from interior until market reforms take hold. Difference should be < 0.5.
    expect(Math.abs(hd1979 - xn1979)).toBeLessThan(0.5);
    expect(Math.abs(hd1979 - hz1979)).toBeLessThan(0.5);
  });
});

describe("getCnModel — 2019 era anchors (reform consolidation)", () => {
  it("HD (East/coastal) is more market-reform than XN (Southwest/interior) in 2019", () => {
    const hdLean = regionMeanEconLean("2019", "HD");
    const xnLean = regionMeanEconLean("2019", "XN");
    expect(hdLean).toBeGreaterThan(xnLean);
  });

  it("HD (East/coastal) is more market-reform than XB (Northwest) in 2019", () => {
    const hdLean = regionMeanEconLean("2019", "HD");
    const xbLean = regionMeanEconLean("2019", "XB");
    expect(hdLean).toBeGreaterThan(xbLean);
  });

  it("HN (South/coastal) is more market-reform than XN (Southwest) in 2019", () => {
    const hnLean = regionMeanEconLean("2019", "HN");
    const xnLean = regionMeanEconLean("2019", "XN");
    expect(hnLean).toBeGreaterThan(xnLean);
  });

  it("HB (North, includes Beijing) is more market-reform than XN in 2019", () => {
    const hbLean = regionMeanEconLean("2019", "HB");
    const xnLean = regionMeanEconLean("2019", "XN");
    expect(hbLean).toBeGreaterThan(xnLean);
  });

  it("2019 national mean is more market-reform than 1979 (reform arc)", () => {
    const mean2019 = nationalMeanEconLean("2019");
    const mean1979 = nationalMeanEconLean("1979");
    expect(mean2019).toBeGreaterThan(mean1979);
  });

  it("2019 national mean econ lean is positive (market-reform dominant)", () => {
    const mean2019 = nationalMeanEconLean("2019");
    expect(mean2019).toBeGreaterThan(0);
  });
});

describe("getCnModel — era arc progression", () => {
  it("HD market-reform lean rises monotonically from 1979 to 2007", () => {
    const lean1979 = regionMeanEconLean("1979", "HD");
    const lean1991 = regionMeanEconLean("1991", "HD");
    const lean1999 = regionMeanEconLean("1999", "HD");
    const lean2007 = regionMeanEconLean("2007", "HD");
    expect(lean1991).toBeGreaterThan(lean1979);
    expect(lean1999).toBeGreaterThan(lean1991);
    expect(lean2007).toBeGreaterThan(lean1999);
  });

  it("HD market-reform lean in 2023 is lower than 2007 peak (Xi re-centralisation)", () => {
    const lean2007 = regionMeanEconLean("2007", "HD");
    const lean2023 = regionMeanEconLean("2023", "HD");
    expect(lean2023).toBeLessThan(lean2007);
  });

  it("XN (interior) remains more state-control than HD from 1991 onward (post-reform divergence)", () => {
    // 1979 is excluded: command economy compressed regional differences to near-zero.
    // From 1991 onward, coastal reforms pull HD positively away from interior XN.
    const eras = ["1991", "1999", "2007", "2019", "2023"] as const;
    for (const era of eras) {
      const hdLean = regionMeanEconLean(era, "HD");
      const xnLean = regionMeanEconLean(era, "XN");
      expect(hdLean, `HD should be >= XN in ${era}`).toBeGreaterThanOrEqual(xnLean);
    }
  });
});

describe("getCnModel — group-level spot checks (2019)", () => {
  it("entrepreneur leans more market-reform than rural_peasant in HD (2019)", () => {
    const model = getCnModel("2019");
    const config = model.census["HD"]!;
    const entrLean = deriveCountryGroupLean(model, "entrepreneur", config).economicLean;
    const peasantLean = deriveCountryGroupLean(model, "rural_peasant", config).economicLean;
    expect(entrLean).toBeGreaterThan(peasantLean);
  });

  it("urban_professional leans more market-reform than migrant_worker in HN (2019)", () => {
    const model = getCnModel("2019");
    const config = model.census["HN"]!;
    const profLean = deriveCountryGroupLean(model, "urban_professional", config).economicLean;
    const migrantLean = deriveCountryGroupLean(model, "migrant_worker", config).economicLean;
    expect(profLean).toBeGreaterThan(migrantLean);
  });

  it("rural_peasant leans more traditional (social right) than youth in HD (2019)", () => {
    const model = getCnModel("2019");
    const config = model.census["HD"]!;
    const peasantSocial = deriveCountryGroupLean(model, "rural_peasant", config).socialLean;
    const youthSocial = deriveCountryGroupLean(model, "youth", config).socialLean;
    expect(peasantSocial).toBeGreaterThan(youthSocial);
  });
});

describe("getCnModel — emergent lean table 1979 vs 2019", () => {
  it("prints readable lean table (informational — always passes)", () => {
    const regions = ["DB", "HB", "HD", "HZ", "HN", "XN", "XB"];
    const regionNames: Record<string, string> = {
      DB: "Dongbei  ",
      HB: "Huabei   ",
      HD: "Huadong  ",
      HZ: "Huazhong ",
      HN: "Huanan   ",
      XN: "Xinan    ",
      XB: "Xibei    ",
    };
    console.log("\n=== CN Region Mean Econ Lean ===");
    console.log("Region     | 1979  | 2019  | Δ");
    console.log("-----------|-------|-------|------");
    for (const r of regions) {
      const l79 = regionMeanEconLean("1979", r);
      const l19 = regionMeanEconLean("2019", r);
      const delta = l19 - l79;
      console.log(
        `${regionNames[r]} | ${l79.toFixed(2).padStart(5)} | ${l19.toFixed(2).padStart(5)} | ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}`
      );
    }
    expect(true).toBe(true);
  });
});
