import { describe, expect, it } from "vitest";
import { driftFromSwing, LIVE_DRIFT_CAP, LIVE_DRIFT_DAMPING } from "./liveLean";

describe("driftFromSwing", () => {
  it("moves a state by its damped swing between two in-world races", () => {
    const drift = driftFromSwing(new Map([["PA", 6]]), new Map([["PA", 2]]));
    expect(drift.get("PA")).toBeCloseTo(4 * LIVE_DRIFT_DAMPING);
  });

  it("ignores the in-world level, so a polarised founding round alone moves nothing", () => {
    const drift = driftFromSwing(new Map([["PA", -45]]), new Map([["PA", -45]]));
    expect(drift.get("PA")).toBe(0);
  });

  it("caps a wild cycle", () => {
    const drift = driftFromSwing(new Map([["AL", 60]]), new Map([["AL", -40]]));
    expect(drift.get("AL")).toBe(LIVE_DRIFT_CAP);
  });

  it("skips states missing from either race", () => {
    expect(driftFromSwing(new Map([["DC", 5]]), new Map()).has("DC")).toBe(false);
  });
});
