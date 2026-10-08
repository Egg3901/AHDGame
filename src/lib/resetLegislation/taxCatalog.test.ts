import { describe, expect, it } from "vitest";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { US_LAWS } from "@/lib/countries/us/data/usLaws";
import { UK_LAWS } from "@/lib/countries/uk/data/ukLaws";
import { US_STATE_TAX_LAWS } from "@/lib/countries/us/data/usStateTaxLaws";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";
import { resetTaxes, resetTaxesFor } from "./taxCatalog";

describe("reset tax instruments", () => {
  it("keeps the nine existing types and exact-rate legislation mappings", () => {
    expect(new Set(resetTaxes.map((tax) => tax.id)).size).toBe(9);
    const runtimeTypes = [
      ...legislationTypes,
      ...US_LAWS.map(projectLawToLegislationType),
      ...UK_LAWS.map(projectLawToLegislationType),
      ...US_STATE_TAX_LAWS.map(projectLawToLegislationType),
    ];
    for (const tax of resetTaxes) {
      const existing = runtimeTypes.find((type) => type._id === tax.existingLegislationTypeId);
      expect(existing, `${tax.country} ${tax.scope} ${tax.id}`).toBeDefined();
      expect(existing?.taxRateChange?.taxType).toBe(tax.taxType);
      expect(existing?.taxRateChange?.scope).toBe(tax.scope === "national" ? "federal" : "state");
      if (tax.scope === "national") {
        expect(
          getCabinetPositions(tax.country).some((seat) => seat.id === tax.overseeingSeatId)
        ).toBe(true);
      } else {
        expect(tax.overseeingSeatId).toBeNull();
      }
    }
  });

  it("does not invent a 1991 UK regional tax fixture", () => {
    expect(resetTaxesFor("UK", "regional")).toEqual([]);
    expect(resetTaxesFor("JP", "regional").map((tax) => tax.id)).toEqual(["T08", "T09"]);
  });

  it("does not reuse UK tax instruments for successor-country budgets", () => {
    expect(resetTaxesFor("SCO", "national")).toEqual([]);
    expect(resetTaxesFor("WAL", "national")).toEqual([]);
  });
});
