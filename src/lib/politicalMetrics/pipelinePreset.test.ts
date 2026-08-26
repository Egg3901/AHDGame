import { describe, expect, it } from "vitest";
import {
  OLD_CATALOG_EXEMPT_TYPE_IDS,
  POLITICAL_LEGISLATION_EXCLUDED_SCOPES,
  isOldCatalogSuperseded,
} from "./pipelinePreset";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

describe("isOldCatalogSuperseded", () => {
  it("supersedes ordinary old US-catalog types", () => {
    expect(isOldCatalogSuperseded({ _id: "min_wage", countryScope: "us" })).toBe(true);
    // Missing countryScope reads as legacy US.
    expect(isOldCatalogSuperseded({ _id: "some_legacy_law" })).toBe(true);
    expect(isOldCatalogSuperseded({ _id: "some_legacy_law", countryScope: "uk" })).toBe(true);
  });

  it("never supersedes other countries' catalogs", () => {
    expect(isOldCatalogSuperseded({ _id: "jp_resident_tax", countryScope: "jp" })).toBe(false);
    expect(isOldCatalogSuperseded({ _id: "de_land_education", countryScope: "de" })).toBe(false);
  });

  it("exempts the mechanical redistricting laws on every world (ticket #1189)", () => {
    for (const id of [
      "us_state_redistricting_authority",
      "us_state_compactness",
      "us_state_fairness",
    ]) {
      expect(OLD_CATALOG_EXEMPT_TYPE_IDS.has(id)).toBe(true);
      expect(isOldCatalogSuperseded({ _id: id, countryScope: "us" })).toBe(false);
    }
  });

  it("every exempt id is a real reference type scoped to an excluded country", () => {
    const byId = new Map(legislationTypes.map((t) => [t._id, t]));
    for (const id of OLD_CATALOG_EXEMPT_TYPE_IDS) {
      const lt = byId.get(id);
      expect(lt, `${id} must exist in the reference catalog`).toBeTruthy();
      expect(POLITICAL_LEGISLATION_EXCLUDED_SCOPES.has(lt!.countryScope ?? "us")).toBe(true);
    }
  });
});
