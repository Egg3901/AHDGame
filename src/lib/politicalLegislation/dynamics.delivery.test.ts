import { describe, expect, it } from "vitest";
import { lawTargets } from "./dynamics";

describe("lawTargets delivery multipliers", () => {
  it("scales only the selected national law contribution", () => {
    const levels = new Map([
      ["us.health.prevention.primary", 2],
      ["us.health.outcomes.primary", 2],
    ]);
    const baseline = lawTargets("US", levels);
    const delivered = lawTargets("US", levels, new Map([["us.health.prevention.primary", 0.4]]));

    expect(delivered["health.prevention"]).toBe(baseline["health.prevention"] * 0.4);
    expect(delivered["health.outcomes"]).toBe(baseline["health.outcomes"]);
  });

  it("clamps multipliers without changing other contributors", () => {
    const levels = new Map([
      ["us.health.prevention.primary", 2],
      ["us.sec.hospitalConstruction", 2],
    ]);
    const baseline = lawTargets("US", levels);
    const suppressed = lawTargets("US", levels, new Map([["us.health.prevention.primary", -1]]));

    expect(baseline["health.prevention"]).toBe(28.5);
    expect(suppressed["health.prevention"]).toBe(3.5);
  });
});
