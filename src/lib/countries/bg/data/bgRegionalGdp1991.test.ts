import { describe, expect, it } from "vitest";
import {
  BG_1991_ESTIMATED_REGION_GDP_BGL,
  BG_1991_REGION_OUTPUT_INDEX,
  BG_1992_OBLAST_INDUSTRIAL_OUTPUT_MILLION_LEV,
} from "./bgRegionalGdp1991";
import { BG_1991_MACROREGION_POPULATION } from "@/lib/countries/bg/data/bgPopulation1991";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "./successorGdp1991";

describe("1991 Bulgarian regional GDP estimate", () => {
  it("transcribes the NSI 1992 industrial-output total and allocates 1991 GDP exactly", () => {
    expect(
      Object.values(BG_1992_OBLAST_INDUSTRIAL_OUTPUT_MILLION_LEV).reduce((a, b) => a + b, 0)
    ).toBe(193_961);
    expect(Object.keys(BG_1991_REGION_OUTPUT_INDEX).sort()).toEqual(
      Object.keys(BG_1991_MACROREGION_POPULATION).sort()
    );
    expect(Object.values(BG_1991_REGION_OUTPUT_INDEX).every((value) => value > 0)).toBe(true);
    expect(Object.values(BG_1991_ESTIMATED_REGION_GDP_BGL).reduce((a, b) => a + b, 0)).toBe(
      SUCCESSOR_NOMINAL_GDP_1991.BG
    );
  });
});
