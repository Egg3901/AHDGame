import { describe, expect, it } from "vitest";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { resetTaxes, resetTaxesFor } from "./taxCatalog";

describe("reset tax instruments", () => {
  it("keeps the nine existing types and exact-rate legislation mappings", () => {
    expect(new Set(resetTaxes.map((tax) => tax.id)).size).toBe(9);
    for (const tax of resetTaxes) {
      const existing = legislationTypes.find((type) => type._id === tax.existingLegislationTypeId);
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
});
