import { describe, expect, it } from "vitest";
import { SUCCESSOR_NOMINAL_GDP_1991 } from "./successorGdp1991";
import { allocateRegionalGdp } from "./rules/allocateRegionalGdp";
import { YU_1989_GSP_USD_PER_PERSON, YU_1991_ESTIMATED_REGION_GDP_YUD } from "./yuRegionalGdp1991";

describe("1991 Yugoslav regional GDP reconstruction", () => {
  it("preserves the observed output ranking and national nominal total", () => {
    expect(YU_1989_GSP_USD_PER_PERSON.YU_SLO).toBeGreaterThan(YU_1989_GSP_USD_PER_PERSON.YU_KOS);
    expect(Object.values(YU_1991_ESTIMATED_REGION_GDP_YUD).reduce((a, b) => a + b, 0)).toBe(
      SUCCESSOR_NOMINAL_GDP_1991.YU
    );
  });

  it("refuses missing regional output instead of silently using population alone", () => {
    expect(() => allocateRegionalGdp(100, { A: 10, B: 20 }, { A: 5 })).toThrow(
      "Missing positive population or output per person for B"
    );
  });
});
