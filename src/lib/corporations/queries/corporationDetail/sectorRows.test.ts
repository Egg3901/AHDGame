import { describe, expect, it } from "vitest";
import { ceoSectorLevers } from "./sectorRows";

describe("ceoSectorLevers", () => {
  it("gives the CEO the posted-price posture and wage level", () => {
    expect(ceoSectorLevers({ pricingPosture: -0.1, wageLevel: 1.2 }, true)).toEqual({
      pricingPosture: -0.1,
      wageLevel: 1.2,
    });
  });

  it("fills the defaults the engine applies when a lever was never set", () => {
    expect(ceoSectorLevers({}, true)).toEqual({ pricingPosture: null, wageLevel: 1 });
  });

  it("adds nothing for any other viewer", () => {
    const levers = ceoSectorLevers({ pricingPosture: 0.2, wageLevel: 0.8 }, false);
    expect(levers).toEqual({});
    expect("pricingPosture" in levers).toBe(false);
    expect("wageLevel" in levers).toBe(false);
  });
});
