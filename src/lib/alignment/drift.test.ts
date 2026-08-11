import { describe, expect, it } from "vitest";
import {
  ALIGNMENT_GATES,
  PER_NATION_TURN_CAP,
  type AlignmentPoleId,
} from "@/lib/constants/alignmentEras";
import { normalizeShares, type AlignmentShares } from "./normalize";
import { leadFor } from "./project";
import {
  computeDrift,
  membershipPullForTurn,
  MEMBERSHIP_PULL_PER_TURN,
  MEMBERSHIP_PULL_CEILING,
} from "./drift";

const TWO: AlignmentPoleId[] = ["WEST", "EAST"];
const at = (w: number, e: number) => normalizeShares({ WEST: w, EAST: e }, TWO);
const total = (s: AlignmentShares) =>
  (Object.values(s.shares) as number[]).reduce((a, b) => a + b, 0) + s.nonAligned;

describe("computeDrift", () => {
  it("moves shares toward the pull and keeps the invariant", () => {
    const before = at(40, 40);
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: 3 } });
    expect(after.shares.WEST!).toBeGreaterThan(before.shares.WEST!);
    expect(total(after)).toBe(100);
  });

  it("does not move a locked nation at all", () => {
    const before = at(2, 90); // lead 88, above the locked gate of 85
    expect(leadFor(before)).toBeGreaterThanOrEqual(ALIGNMENT_GATES.locked);
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: 9 } });
    expect(after).toEqual(before);
  });

  it("halves movement for an uncommitted nation", () => {
    const nonAligned = at(30, 24); // lead 6, inside the non-aligned band
    const committed = at(60, 8); // lead 52, outside it
    expect(leadFor(nonAligned)).toBeLessThanOrEqual(ALIGNMENT_GATES.nonAligned);
    expect(leadFor(committed)).toBeGreaterThan(ALIGNMENT_GATES.nonAligned);

    const dNon =
      computeDrift({ shares: nonAligned, poles: TWO, pull: { WEST: 4 } }).shares.WEST! -
      nonAligned.shares.WEST!;
    const dCom =
      computeDrift({ shares: committed, poles: TWO, pull: { WEST: 4 } }).shares.WEST! -
      committed.shares.WEST!;
    expect(dNon).toBeLessThan(dCom);
  });

  it("never exceeds the per-nation turn cap", () => {
    const before = at(30, 30);
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: 500 } });
    const moved =
      Math.abs(after.shares.WEST! - before.shares.WEST!) +
      Math.abs(after.shares.EAST! - before.shares.EAST!);
    expect(moved).toBeLessThanOrEqual(PER_NATION_TURN_CAP);
    expect(total(after)).toBe(100);
  });

  it("is a no-op when nothing pulls", () => {
    const before = at(40, 30);
    expect(computeDrift({ shares: before, poles: TWO, pull: {} })).toEqual(before);
  });

  it("takes from the uncommitted remainder before other poles", () => {
    const before = at(20, 20); // 60 uncommitted
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: 5 } });
    expect(after.nonAligned).toBeLessThan(before.nonAligned);
    expect(after.shares.EAST!).toBe(before.shares.EAST!);
  });

  it("bites a rival pole once the uncommitted pool is spent", () => {
    const before = at(50, 50); // nothing uncommitted left to take
    expect(before.nonAligned).toBe(0);
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: 10 } });
    expect(after.shares.EAST!).toBeLessThan(before.shares.EAST!);
    expect(total(after)).toBe(100);
  });

  it("can push a nation away from a pole on a negative pull", () => {
    const before = at(60, 10);
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: -5 } });
    expect(after.shares.WEST!).toBeLessThan(before.shares.WEST!);
    expect(total(after)).toBe(100);
  });

  // Committed nation (lead 40) so the non-aligned halving does not muddy the
  // netting these three are actually about.
  const committed = () => at(60, 20);

  it("cancels opposing pulls before the ceiling — an even contest barely moves", () => {
    const before = committed();
    // Both blocs push hard against each other; only the margin survives.
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: 8, EAST: 6 } });
    expect(after.shares.WEST! - before.shares.WEST!).toBe(2);
    expect(after.shares.EAST!).toBe(before.shares.EAST!);
  });

  it("moves hard when a push is unopposed", () => {
    const before = committed();
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: 8 } });
    // 8 of net pull, ceiling 5.
    expect(after.shares.WEST! - before.shares.WEST!).toBe(PER_NATION_TURN_CAP);
  });

  it("halves the surviving margin for a nation nobody has committed", () => {
    // Same contest on an uncommitted nation: the margin still wins, but the
    // non-aligned resistance means it buys half as much ground.
    const before = at(40, 40);
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: 8, EAST: 6 } });
    expect(after.shares.WEST! - before.shares.WEST!).toBe(1);
  });

  it("lets allies stack rather than cannibalise each other", () => {
    const before = at(40, 40);
    // Two organisations on the same pole: their money adds up.
    const together = computeDrift({ shares: before, poles: TWO, pull: { WEST: 2 + 2 } });
    const alone = computeDrift({ shares: before, poles: TWO, pull: { WEST: 2 } });
    expect(together.shares.WEST!).toBeGreaterThan(alone.shares.WEST!);
  });

  it("gives a dead-heat contest nothing at all", () => {
    const before = at(40, 40);
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: 6, EAST: 6 } });
    expect(after).toEqual(before);
  });

  it("still lets a de-aligning push erode a pole nobody is defending", () => {
    const before = at(60, 10);
    const after = computeDrift({ shares: before, poles: TWO, pull: { WEST: -4 } });
    expect(after.shares.WEST!).toBeLessThan(before.shares.WEST!);
  });

  it("honours a raised ceiling for a nation in crisis", () => {
    const before = at(40, 40);
    const normal = computeDrift({ shares: before, poles: TWO, pull: { WEST: 20 } });
    const crisis = computeDrift({ shares: before, poles: TWO, pull: { WEST: 20 }, cap: 7.5 });
    expect(crisis.shares.WEST!).toBeGreaterThan(normal.shares.WEST!);
  });

  it("makes a counter-op cancel the push it answers, not merely offset it", () => {
    // Under netting a provoking channel pays for its own opposition out of its
    // margin: 10 of push answered by 5 nets 5, not 10 against 5.
    const before = committed();
    const unopposed = computeDrift({ shares: before, poles: TWO, pull: { WEST: 10 } });
    const answered = computeDrift({ shares: before, poles: TWO, pull: { WEST: 10, EAST: 5 } });

    // Unopposed saturates the ceiling; answered nets exactly to it, so the
    // counter-op has eaten everything above the cap.
    expect(unopposed.shares.WEST! - before.shares.WEST!).toBe(PER_NATION_TURN_CAP);
    expect(answered.shares.WEST! - before.shares.WEST!).toBe(PER_NATION_TURN_CAP);
    // And the answering pole gains nothing at all — it only denied.
    expect(answered.shares.EAST!).toBe(before.shares.EAST!);
  });
});

describe("membershipPullForTurn", () => {
  it("pays about one point per 24 turns", () => {
    // The rate the tenth-point grid could not express: 0.04 a turn rounded to
    // nothing there, every turn, so the tide was inert. A hundredth carries it.
    const perTurn = membershipPullForTurn({ weight: 1, currentShare: 0 });
    expect(perTurn).toBe(MEMBERSHIP_PULL_PER_TURN);
    expect(perTurn * 24).toBeCloseTo(0.96, 5);
  });

  it("survives a write instead of rounding away", () => {
    // The whole point of the precision change. Applied to a real share through
    // the single write path, 0.04 must still be there afterwards.
    const poles = ["WEST", "EAST"] as AlignmentPoleId[];
    let shares = normalizeShares({ WEST: 40, EAST: 10 }, poles);
    for (let t = 0; t < 5; t++) {
      shares = normalizeShares(
        {
          WEST:
            (shares.shares.WEST ?? 0) +
            membershipPullForTurn({ weight: 1, currentShare: shares.shares.WEST ?? 0 }),
          EAST: shares.shares.EAST ?? 0,
        },
        poles
      );
    }
    expect(shares.shares.WEST).toBeCloseTo(40.2, 5);
  });

  it("scales with the channel's weight", () => {
    expect(membershipPullForTurn({ weight: 0.6, currentShare: 0 })).toBeCloseTo(0.024, 5);
    expect(membershipPullForTurn({ weight: 0, currentShare: 0 })).toBe(0);
  });

  it("stops at the ceiling, and never pushes back down through it", () => {
    expect(
      membershipPullForTurn({ weight: 1, currentShare: MEMBERSHIP_PULL_CEILING - 0.01 })
    ).toBeCloseTo(0.01, 5);
    expect(membershipPullForTurn({ weight: 1, currentShare: MEMBERSHIP_PULL_CEILING })).toBe(0);
    // A nation carried past the ceiling by deliberate plays keeps its ground:
    // drift stops adding rather than clawing anything back.
    expect(membershipPullForTurn({ weight: 1, currentShare: 90 })).toBe(0);
  });

  it("is far weaker than a single play", () => {
    // The rudder must outweigh the current. A turn at the per-nation cap is
    // worth more than two game YEARS of belonging.
    const perGameYear = MEMBERSHIP_PULL_PER_TURN * 48;
    expect(PER_NATION_TURN_CAP / perGameYear).toBeGreaterThan(2);
  });
});
