import { describe, expect, it } from "vitest";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "./successorGdp1991";
import { HU_1991_ESTIMATED_REGION_GDP_HUF, HU_1991_REGION_OUTPUT_INDEX } from "./huRegionalGdp1991";

describe("1991 Hungarian regional GDP reconstruction", () => {
  it("retains the observed Budapest/North gap and the national nominal total", () => {
    expect(HU_1991_REGION_OUTPUT_INDEX.HU_BUD).toBeGreaterThan(HU_1991_REGION_OUTPUT_INDEX.HU_NOR);
    expect(Object.values(HU_1991_ESTIMATED_REGION_GDP_HUF).reduce((a, b) => a + b, 0)).toBe(
      SUCCESSOR_NOMINAL_GDP_1991.HU
    );
  });
});
