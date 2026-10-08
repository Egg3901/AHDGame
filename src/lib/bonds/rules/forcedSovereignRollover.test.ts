import { describe, expect, it } from "vitest";
import { planForcedPoolRollover } from "./forcedSovereignRollover";

describe("planForcedPoolRollover", () => {
  it("rolls every remaining pool unit at par", () => {
    expect(
      planForcedPoolRollover({
        liveFloatUnits: 10,
        liveTotalIssued: 12_000,
        poolLegAmount: 10_000,
        novatedUnits: 0,
      })
    ).toEqual({ units: 10, faceLocal: 10_000 });
  });

  it("nets an earlier novation out of the pool leg", () => {
    expect(
      planForcedPoolRollover({
        liveFloatUnits: 4,
        liveTotalIssued: 5_000,
        poolLegAmount: 10_000,
        novatedUnits: 6,
      })
    ).toEqual({ units: 4, faceLocal: 4_000 });
  });

  it("refuses when no float is left, state is invalid, or the pool leg cannot cover it", () => {
    const base = {
      liveFloatUnits: 4,
      liveTotalIssued: 5_000,
      poolLegAmount: 4_000,
      novatedUnits: 0,
    };
    expect(planForcedPoolRollover({ ...base, liveFloatUnits: 0 }).refusal).toBe("no_float");
    expect(planForcedPoolRollover({ ...base, liveFloatUnits: 1.5 }).refusal).toBe("invalid_state");
    expect(planForcedPoolRollover({ ...base, liveTotalIssued: 3_000 }).refusal).toBe(
      "float_exceeds_principal"
    );
    expect(planForcedPoolRollover({ ...base, poolLegAmount: 3_000 }).refusal).toBe(
      "pool_leg_mismatch"
    );
  });
});
