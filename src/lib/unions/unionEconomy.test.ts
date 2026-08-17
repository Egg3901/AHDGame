import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  strikeCallCost,
  STRIKE_CALL_COST_PER_SECTOR,
  buildUnionStrikePreview,
  unionStrikeBlockReason,
} from "./unionEconomy";
import type { CorporateSector } from "@/lib/db/types";

// Recruitment-drive (recruitPressureGain/applyRecruit) and pressure-trickle
// dues (duesTrickle/decayMembershipPressure) coverage retired with union dues
// v1, membershipPressure no longer exists. Dues income, service cost, and
// approval trending are pure functions in `src/lib/unions/unionDues.ts`
// (foundation, not owned by this change); their per-turn orchestration,
// scaling with members, services lapsing on a short treasury, approval
// trending toward target, is covered in `src/lib/turn/unions/index.test.ts`.
// Strength/strike-preview logic below is unchanged by dues v1.

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
