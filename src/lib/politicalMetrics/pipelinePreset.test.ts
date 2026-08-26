import { describe, expect, it } from "vitest";
import { isOldLegislationTypeExcluded, isPoliticalPipelinePreset } from "./pipelinePreset";

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
