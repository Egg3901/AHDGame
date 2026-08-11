import { describe, expect, it } from "vitest";
import {
  canonicalizeLegislationTypeId,
  getEquivalentLegislationTypeIds,
  getLegislationTypeById,
  humanizeLegislationTypeId,
} from "@/lib/legislationTypeAliases";

describe("legislationTypeAliases", () => {
  it("canonicalizes legacy legislation type ids", () => {
    expect(canonicalizeLegislationTypeId("us_federal_corporate_tax_rate")).toBe(
      "us_federal_domestic_corporate_tax_rate"
    );
    expect(canonicalizeLegislationTypeId("us_federal_domestic_corporate_tax_rate")).toBe(
      "us_federal_domestic_corporate_tax_rate"
    );
    expect(canonicalizeLegislationTypeId(null)).toBeNull();
  });

  it("returns equivalent ids including canonical and legacy values", () => {
    expect(getEquivalentLegislationTypeIds("us_federal_corporate_tax_rate")).toEqual(
      expect.arrayContaining([
        "us_federal_corporate_tax_rate",
        "us_federal_domestic_corporate_tax_rate",
      ])
    );
  });

  it("resolves legislation types from either canonical or legacy ids", () => {
    const legislationTypeMap = new Map([
      [
        "us_federal_domestic_corporate_tax_rate",
        {
          _id: "us_federal_domestic_corporate_tax_rate",
          name: "Federal Domestic Corporate Tax Rate",
        },
      ],
    ]);

    expect(getLegislationTypeById(legislationTypeMap, "us_federal_corporate_tax_rate")?.name).toBe(
      "Federal Domestic Corporate Tax Rate"
    );
  });

  it("humanizes canonical legislation type ids into readable labels", () => {
    expect(humanizeLegislationTypeId("us_federal_corporate_tax_rate")).toBe(
      "Federal Domestic Corporate Tax Rate"
    );
  });
});
