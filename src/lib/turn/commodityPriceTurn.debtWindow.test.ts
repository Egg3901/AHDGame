import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

import { recentDebtIssuanceFilter } from "./commodityPriceTurn";

type BondDoc = { issuedAtTurn: number; matured: boolean; redeemedAtTurn?: number };

/** Minimal evaluator for the exact filter shape returned by recentDebtIssuanceFilter. */
function matches(turn: number, bond: BondDoc): boolean {
  const f = recentDebtIssuanceFilter(turn);
  const inWindow =
    bond.issuedAtTurn >= f.issuedAtTurn.$gte && bond.issuedAtTurn < f.issuedAtTurn.$lt;
  const live =
    bond.matured === f.$or[0].matured ||
    (bond.redeemedAtTurn !== undefined && bond.redeemedAtTurn >= f.$or[1].redeemedAtTurn!.$gte);
  return inWindow && live;
}

/**
 * Quarterly sovereign issuance (every 12 turns, 48-turn maturity), viewed as
 * commodity pricing might see it while bondTurn runs in parallel: either before
 * this turn's issuance and maturity land, or after both have landed.
 */
function quarterlyBonds(turn: number, bondTurnDone: boolean): BondDoc[] {
  const bonds: BondDoc[] = [];
  const lastIssue = bondTurnDone ? turn : turn - 1;
  for (let issued = 12; issued <= lastIssue; issued += 12) {
    const maturedNow = bondTurnDone ? turn >= issued + 48 : turn - 1 >= issued + 48;
    const redeemedAt = maturedNow
      ? turn >= issued + 48 && bondTurnDone
        ? turn
        : issued + 48
      : undefined;
    bonds.push({ issuedAtTurn: issued, matured: maturedNow, redeemedAtTurn: redeemedAt });
  }
  return bonds;
}

describe("recentDebtIssuanceFilter", () => {
  it("counts the completed year before the turn, excluding the current turn", () => {
    const f = recentDebtIssuanceFilter(156);
    expect(f.issuedAtTurn).toEqual({ $gte: 108, $lt: 156 });
    expect(recentDebtIssuanceFilter(10).issuedAtTurn).toEqual({ $gte: 0, $lt: 10 });
  });

  it("sees the same number of quarterly cohorts on every turn, whatever bondTurn has done", () => {
    for (let turn = 100; turn <= 200; turn++) {
      for (const done of [false, true]) {
        const counted = quarterlyBonds(turn, done).filter((b) => matches(turn, b)).length;
        expect({ turn, done, counted }).toEqual({ turn, done, counted: 4 });
      }
    }
  });

  it("still drops bonds redeemed on an earlier turn", () => {
    expect(matches(150, { issuedAtTurn: 120, matured: true, redeemedAtTurn: 140 })).toBe(false);
    expect(matches(150, { issuedAtTurn: 120, matured: true, redeemedAtTurn: 150 })).toBe(true);
    expect(matches(150, { issuedAtTurn: 120, matured: true })).toBe(false);
  });
});
