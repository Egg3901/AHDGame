import { describe, expect, it } from "vitest";
import { productionStabilityReport } from "./productionDemandStability";

describe("multi-turn demand feedback", () => {
  it("settles without the repeated shortage/glut cycle, including after a demand shock", () => {
    expect(productionStabilityReport().passed).toBe(true);
  });
});
