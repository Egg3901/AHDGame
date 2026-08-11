import { describe, expect, it } from "vitest";
import { planOpeningForceDeployment } from "./openingForces";

const unit = (id: string, countryId: string, basePower: number) => ({
  id,
  countryId,
  basePower,
});

describe("planOpeningForceDeployment", () => {
  it("commits a small comparable force from both sides", () => {
    const plan = planOpeningForceDeployment(
      [
        unit("a1", "US", 60),
        unit("a2", "US", 120),
        unit("a3", "US", 200),
        unit("b1", "DD", 70),
        unit("b2", "DD", 110),
        unit("b3", "DD", 300),
      ],
      ["US"],
      ["DD"]
    );

    expect(plan.sideAIds).toEqual(["a1", "a2"]);
    expect(plan.sideBIds).toEqual(["b1", "b2"]);
    expect(plan.sideAPower).toBe(180);
    expect(plan.sideBPower).toBe(180);
  });

  it("does not deploy one side when the other has no reserve forces", () => {
    expect(planOpeningForceDeployment([unit("a1", "US", 100)], ["US"], ["DD"])).toEqual({
      sideAIds: [],
      sideBIds: [],
      sideAPower: 0,
      sideBPower: 0,
    });
  });
});
