import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
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
  buildUnionStrikePreview,
  unionStrikeBlockReason,
} from "./unionEconomy";
import type { CorporateSector } from "@/lib/db/types";

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

function strikeSector(
  overrides: Partial<
    Pick<
      CorporateSector,
      "_id" | "unionization" | "strikeStartedAtTurn" | "strikeCooldownUntilTurn"
    >
  > = {}
) {
  return {
    _id: new ObjectId(),
    unionization: 40,
    strikeStartedAtTurn: null,
    strikeCooldownUntilTurn: null,
    ...overrides,
  };
}

describe("union strike preview", () => {
  it("uses the same organization, active-strike, and cooldown rules for every local", () => {
    expect(unionStrikeBlockReason(strikeSector({ unionization: 29.9 }), 10)).toBe("underorganized");
    expect(unionStrikeBlockReason(strikeSector({ strikeStartedAtTurn: 9 }), 10)).toBe(
      "already_striking"
    );
    expect(unionStrikeBlockReason(strikeSector({ strikeCooldownUntilTurn: 11 }), 10)).toBe(
      "sector_cooldown"
    );
    expect(unionStrikeBlockReason(strikeSector({ strikeCooldownUntilTurn: 10 }), 10)).toBeNull();
    const protectedLocal = strikeSector();
    expect(
      unionStrikeBlockReason(protectedLocal, 10, new Set([protectedLocal._id.toString()]))
    ).toBe("collective_agreement");
  });

  it("prices only eligible locals and explains every exclusion", () => {
    const preview = buildUnionStrikePreview(
      { lastCalledStrikeTurn: 7 },
      [
        strikeSector(),
        strikeSector({ unionization: 10 }),
        strikeSector({ strikeStartedAtTurn: 8 }),
        strikeSector({ strikeCooldownUntilTurn: 20 }),
      ],
      10
    );

    expect(preview.eligibleSectors).toHaveLength(1);
    expect(preview.cost).toBe(STRIKE_CALL_COST_PER_SECTOR);
    expect(preview.unionCooldownTurnsRemaining).toBe(5);
    expect(preview.blocked).toEqual({
      underorganized: 1,
      already_striking: 1,
      sector_cooldown: 1,
      collective_agreement: 0,
    });
  });
});
