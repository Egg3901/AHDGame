import { describe, expect, it } from "vitest";
import { PL_1991_MACROREGION_VOIVODESHIPS } from "@/lib/countries/pl/data/plPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "./successorGdp1991";
import {
  PL_1991_ESTIMATED_REGION_GDP_PLZ,
  PL_1991_MACROREGION_OUTPUT_INDEX,
  PL_1992_SELECTED_GDP_PER_CAPITA_INDEX,
} from "./plRegionalGdp1991";

describe("1991 Polish regional GDP backcast", () => {
  it("has an observed 1992 output anchor in every 1991 macroregion", () => {
    for (const names of Object.values(PL_1991_MACROREGION_VOIVODESHIPS)) {
      expect(names.some((name) => name in PL_1992_SELECTED_GDP_PER_CAPITA_INDEX)).toBe(true);
    }
  });

  it("preserves real observed output differences and the national GDP total", () => {
    expect(PL_1991_MACROREGION_OUTPUT_INDEX.PL_MAZ).toBeGreaterThan(
      PL_1991_MACROREGION_OUTPUT_INDEX.PL_EAS
    );
    expect(Object.values(PL_1991_ESTIMATED_REGION_GDP_PLZ).reduce((a, b) => a + b, 0)).toBe(
      SUCCESSOR_NOMINAL_GDP_1991.PL
    );
  });
});
