import { describe, expect, it } from "vitest";
import { ceoSectorLevers } from "./sectorRows";

describe("ceoSectorLevers", () => {
  it("gives the CEO the product quote policies and wage level", () => {
    expect(
      ceoSectorLevers(
        { producerQuotes: { energy: { kind: "costPlus", markup: -0.1 } }, wageLevel: 1.2 },
        true
      )
    ).toEqual({
      producerQuotes: { energy: { kind: "costPlus", markup: -0.1 } },
      wageLevel: 1.2,
    });
  });

  it("fills the defaults the engine applies when a lever was never set", () => {
    expect(ceoSectorLevers({}, true)).toEqual({ producerQuotes: {}, wageLevel: 1 });
  });

  it("adds nothing for any other viewer", () => {
    const levers = ceoSectorLevers(
      { producerQuotes: { energy: { kind: "manual", unitPrice: 2 } }, wageLevel: 0.8 },
      false
    );
    expect(levers).toEqual({});
    expect("producerQuotes" in levers).toBe(false);
    expect("wageLevel" in levers).toBe(false);
  });
});
