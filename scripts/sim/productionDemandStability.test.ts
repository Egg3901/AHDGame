import { describe, expect, it } from "vitest";
import { productionStabilityReport, productionTrajectory } from "./productionDemandStability";

describe("multi-turn demand feedback", () => {
  it("settles without the repeated shortage/glut cycle, including after a demand shock", () => {
    expect(productionStabilityReport().passed).toBe(true);
  });
  it.each([0, 0.1, 3])(
    "settles with asymmetric co-product demand at %sx the primary market",
    (scale) => {
      const rows = productionTrajectory(true, true, true, scale);
      const terminal = rows.slice(-24).map((row) => row.produced);
      expect(Math.max(...terminal) - Math.min(...terminal)).toBeLessThan(0.001);
      expect(
        rows.every(
          (row) => Number.isFinite(row.produced) && row.produced >= 0 && row.produced <= 67100
        )
      ).toBe(true);
    }
  );
});
