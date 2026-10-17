import { describe, it, expect } from "vitest";
import { restartProductionFactor } from "./restartRun";

describe("restartProductionFactor", () => {
  it("is 1 when the plant is not restarting", () => {
    expect(
      restartProductionFactor({ restartRunShare: 1, guaranteedUnits: 0, plannedUnits: 100 })
    ).toBe(1);
  });
  it("runs the restart share on a restart turn", () => {
    expect(
      restartProductionFactor({ restartRunShare: 0.25, guaranteedUnits: null, plannedUnits: 100 })
    ).toBe(0.25);
  });
  it("covers contracted volume when that is more", () => {
    expect(
      restartProductionFactor({ restartRunShare: 0.25, guaranteedUnits: 60, plannedUnits: 100 })
    ).toBeCloseTo(0.6, 10);
    expect(
      restartProductionFactor({ restartRunShare: 0.25, guaranteedUnits: 500, plannedUnits: 100 })
    ).toBe(1);
  });
});
