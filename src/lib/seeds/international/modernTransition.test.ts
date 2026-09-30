import { describe, expect, it } from "vitest";
import { getPlModel } from "./pl";
import { getRoModel } from "./ro";
import { getCountryLayer1Model } from "./index";
import { EASTERN_BLOC_GROUP_IDS } from "@/lib/seeds/shared/easternBlocModel";

const PL_REGION_IDS = [
  "PL_MAZ",
  "PL_LOD",
  "PL_MAL",
  "PL_SLK",
  "PL_DSL",
  "PL_WLK",
  "PL_POM",
  "PL_EAS",
];
const RO_REGION_IDS = ["RO_BUC", "RO_MUN", "RO_OLT", "RO_TRA", "RO_VST", "RO_MOL", "RO_DOB"];

describe("PL 2027 modern Layer-1 model", () => {
  it("uses democratic voter groups over the authored 2027 region keys", () => {
    const model = getPlModel("2027");
    expect(model.countryId).toBe("PL");
    expect(model.categoryId).toBe("pl_voterGroups");
    expect(model.groupIds).toEqual([
      "rural_conservative",
      "urban_civic",
      "agrarian_centre",
      "progressive_left",
      "libertarian_nationalist",
      "silesian_minority",
    ]);
    for (const blocId of EASTERN_BLOC_GROUP_IDS) {
      expect(model.groupIds).not.toContain(blocId);
    }
    expect(Object.keys(model.census).sort()).toEqual([...PL_REGION_IDS].sort());
  });

  it("references only valid demographic keys in every composition weight", () => {
    const model = getPlModel("2027");
    for (const [gid, entry] of Object.entries(model.composition)) {
      for (const w of entry.weights as Array<{ dim: string; key: string }>) {
        expect(model.turnoutRates[w.dim], `${gid} references unknown dim ${w.dim}`).toBeDefined();
        expect(
          model.turnoutRates[w.dim]?.[w.key],
          `${gid} references unknown key ${w.dim}.${w.key}`
        ).toBeDefined();
      }
    }
  });

  it("preserves the 1979 communist-archetype model", () => {
    expect(getPlModel("1979").groupIds).toEqual([...EASTERN_BLOC_GROUP_IDS]);
    expect(getPlModel("1953").groupIds).toEqual([...EASTERN_BLOC_GROUP_IDS]);
  });
});

describe("RO 2027 modern Layer-1 model", () => {
  it("uses democratic voter groups over the authored 2027 region keys", () => {
    const model = getRoModel("2027");
    expect(model.countryId).toBe("RO");
    expect(model.categoryId).toBe("ro_voterGroups");
    expect(model.groupIds).toEqual([
      "social_rural",
      "urban_reformist",
      "nationalist_populist",
      "liberal_centre",
      "hungarian_minority",
      "green_youth",
    ]);
    for (const blocId of EASTERN_BLOC_GROUP_IDS) {
      expect(model.groupIds).not.toContain(blocId);
    }
    expect(Object.keys(model.census).sort()).toEqual([...RO_REGION_IDS].sort());
  });

  it("references only valid demographic keys in every composition weight", () => {
    const model = getRoModel("2027");
    for (const [gid, entry] of Object.entries(model.composition)) {
      for (const w of entry.weights as Array<{ dim: string; key: string }>) {
        expect(model.turnoutRates[w.dim], `${gid} references unknown dim ${w.dim}`).toBeDefined();
        expect(
          model.turnoutRates[w.dim]?.[w.key],
          `${gid} references unknown key ${w.dim}.${w.key}`
        ).toBeDefined();
      }
    }
  });

  it("preserves the 1979 communist-archetype model", () => {
    expect(getRoModel("1979").groupIds).toEqual([...EASTERN_BLOC_GROUP_IDS]);
    expect(getRoModel("1953").groupIds).toEqual([...EASTERN_BLOC_GROUP_IDS]);
  });
});

describe("Layer-1 index routing for the transition countries", () => {
  it("resolves the modern models for era 2027 without an index change", () => {
    expect(getCountryLayer1Model("PL", "2027")?.groupIds).toContain("urban_civic");
    expect(getCountryLayer1Model("RO", "2027")?.groupIds).toContain("urban_reformist");
  });

  it("keeps routing 1991 through the successor model", () => {
    expect(getCountryLayer1Model("PL", "1991")).not.toBeNull();
    expect(getCountryLayer1Model("RO", "1991")).not.toBeNull();
  });
});
