import { describe, expect, it } from "vitest";
import {
  isOldLegislationTypeExcluded,
  isPoliticalPipelinePreset,
  POLITICAL_LEGISLATION_RETAINED_OLD_IDS,
} from "./pipelinePreset";
import { getAllNewGenerationLawIds } from "@/lib/politicalLegislation/catalog";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

describe("isPoliticalPipelinePreset", () => {
  it("is true for every preset — the pipeline is year-driven, not preset-driven", () => {
    expect(isPoliticalPipelinePreset("1953-default")).toBe(true);
    expect(isPoliticalPipelinePreset("2019-default")).toBe(true);
    expect(isPoliticalPipelinePreset("1991-default")).toBe(true);
    expect(isPoliticalPipelinePreset(undefined)).toBe(true);
  });
});

describe("isOldLegislationTypeExcluded", () => {
  it("excludes old playable-country catalogs", () => {
    expect(isOldLegislationTypeExcluded({ _id: "us_federal_income_tax_rate" })).toBe(true);
    expect(isOldLegislationTypeExcluded({ _id: "uk_nhs", countryScope: "uk" })).toBe(true);
    expect(isOldLegislationTypeExcluded({ _id: "su_planning", countryScope: "ru" })).toBe(true);
    expect(isOldLegislationTypeExcluded({ _id: "dd_planning", countryScope: "dd" })).toBe(true);
  });

  it("keeps non-playable countries' old catalogs", () => {
    expect(isOldLegislationTypeExcluded({ _id: "jp_pensions", countryScope: "jp" })).toBe(false);
  });

  it("retains the state redistricting levers the new-generation catalog has no equivalent for", () => {
    for (const id of [
      "us_state_redistricting_authority",
      "us_state_compactness",
      "us_state_fairness",
    ]) {
      expect(isOldLegislationTypeExcluded({ _id: id, countryScope: "us" }), id).toBe(false);
    }
  });
});

describe("POLITICAL_LEGISLATION_RETAINED_OLD_IDS", () => {
  it("names only ids that exist in the reference catalog", () => {
    const byId = new Set(legislationTypes.map((lt) => lt._id));
    for (const id of POLITICAL_LEGISLATION_RETAINED_OLD_IDS) {
      expect(byId.has(id), `retained id ${id} is not in the reference catalog`).toBe(true);
    }
  });

  it("never collides with a new-generation id", () => {
    // Both sets are upserted into legislationTypes by _id, so an overlap would
    // have one generation silently overwrite the other.
    const newGen = new Set(getAllNewGenerationLawIds());
    for (const id of POLITICAL_LEGISLATION_RETAINED_OLD_IDS) {
      expect(newGen.has(id), `retained id ${id} collides with a new-generation law`).toBe(false);
    }
  });
});
