import { describe, expect, it } from "vitest";
import {
  recruitPressureGain,
  applyRecruit,
  decayMembershipPressure,
  MEMBERSHIP_PRESSURE_DECAY_PER_TURN,
  duesTrickle,
  DUES_TRICKLE_RATE_PER_PRESSURE_POINT,
  strikeCallCost,
  STRIKE_CALL_COST_PER_SECTOR,
  RECRUIT_PRESSURE_GAIN_AT_ZERO,
} from "./unionEconomy";

describe("recruitPressureGain", () => {
  it("is at its maximum at pressure 0", () => {
    expect(recruitPressureGain(0)).toBe(RECRUIT_PRESSURE_GAIN_AT_ZERO);
  });

  it("tapers to 0 at pressure 100 (diminishing returns)", () => {
    expect(recruitPressureGain(100)).toBe(0);
  });

  it("is monotonically decreasing in pressure", () => {
    expect(recruitPressureGain(80)).toBeLessThan(recruitPressureGain(20));
  });
});

describe("applyRecruit", () => {
  it("increases membershipPressure", () => {
    expect(applyRecruit(0)).toBeGreaterThan(0);
  });

  it("clamps at 100", () => {
    expect(applyRecruit(99)).toBeLessThanOrEqual(100);
    expect(applyRecruit(100)).toBe(100);
  });
});

describe("decayMembershipPressure", () => {
  it("steps down by MEMBERSHIP_PRESSURE_DECAY_PER_TURN", () => {
    expect(decayMembershipPressure(10)).toBe(10 - MEMBERSHIP_PRESSURE_DECAY_PER_TURN);
  });

  it("floors at 0", () => {
    expect(decayMembershipPressure(0)).toBe(0);
    expect(decayMembershipPressure(0.1)).toBe(0);
  });
});

describe("duesTrickle", () => {
  it("is proportional to membershipPressure", () => {
    expect(duesTrickle(50)).toBe(50 * DUES_TRICKLE_RATE_PER_PRESSURE_POINT);
  });

  it("is 0 at 0 pressure", () => {
    expect(duesTrickle(0)).toBe(0);
  });
});

describe("strikeCallCost", () => {
  it("scales linearly with matched sector count", () => {
    expect(strikeCallCost(3)).toBe(3 * STRIKE_CALL_COST_PER_SECTOR);
  });

  it("is 0 for 0 sectors", () => {
    expect(strikeCallCost(0)).toBe(0);
  });
});
