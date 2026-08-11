import { describe, expect, it } from "vitest";
import {
  computeBlocStress,
  blocPlayEffectiveness,
  blocStressLabel,
  STRESS_MAX_DAMPING,
  DIGESTION_WINDOW_TURNS,
  type BlocMemberState,
} from "./blocStress";
import { AUTHORED_ALIGNMENT } from "@/lib/constants/alignmentSeeds";

const TURN = 500;

function settled(entityId: string): BlocMemberState {
  // No rival invested, nobody wants out, acceded long ago.
  return { entityId, share: 95, rivalShare: 2, wantsOutSinceTurn: null, joinedTurn: 1 };
}

describe("bloc stress", () => {
  it("is zero for a settled bloc", () => {
    const b = computeBlocStress([settled("A"), settled("B"), settled("C")], TURN);
    expect(b.stress).toBe(0);
    expect(blocPlayEffectiveness(b.stress)).toBe(1);
    expect(blocStressLabel(b.stress)).toBe("Settled");
  });

  // An empty bloc has nothing to hold together. Without the guard the member
  // divisions are 0/0 and it would read as maximally stressed.
  it("is zero for an empty bloc rather than NaN or maximal", () => {
    const b = computeBlocStress([], TURN);
    expect(b.stress).toBe(0);
    expect(b.memberCount).toBe(0);
    expect(Number.isNaN(b.stress)).toBe(false);
  });

  // The deliberate non-input. A large settled alliance is the historically
  // strong case; taxing size directly would make expansion bad rather than
  // costly, which is a different and worse mechanic.
  it("does not tax size — ten settled members cost the same as two", () => {
    const two = computeBlocStress([settled("A"), settled("B")], TURN);
    const ten = computeBlocStress(
      Array.from({ length: 10 }, (_, i) => settled(`M${i}`)),
      TURN
    );
    expect(ten.stress).toBe(two.stress);
  });

  it("rises when members are contested", () => {
    const base = computeBlocStress([settled("A"), settled("B")], TURN);
    const contested = computeBlocStress(
      [settled("A"), { ...settled("B"), share: 40, rivalShare: 45 }],
      TURN
    );
    expect(contested.stress).toBeGreaterThan(base.stress);
    expect(contested.contested).toBeCloseTo(0.5, 6);
  });

  it("rises when a member is heading for the door", () => {
    const base = computeBlocStress([settled("A"), settled("B")], TURN);
    const leaving = computeBlocStress(
      [settled("A"), { ...settled("B"), wantsOutSinceTurn: TURN - 3 }],
      TURN
    );
    expect(leaving.stress).toBeGreaterThan(base.stress);
    expect(leaving.wantsOut).toBeCloseTo(0.5, 6);
  });

  // Digestion is a transition cost, not a permanent tax on having expanded.
  it("decays as new members settle in", () => {
    const fresh = computeBlocStress(
      [settled("A"), { ...settled("B"), joinedTurn: TURN - 1 }],
      TURN
    );
    const digested = computeBlocStress(
      [settled("A"), { ...settled("B"), joinedTurn: TURN - DIGESTION_WINDOW_TURNS }],
      TURN
    );
    expect(fresh.digesting).toBeCloseTo(0.5, 6);
    expect(digested.digesting).toBe(0);
    expect(digested.stress).toBeLessThan(fresh.stress);
  });

  it("stays within 0-1 with every input maxed", () => {
    const worst = computeBlocStress(
      [
        { entityId: "A", share: 0, rivalShare: 90, wantsOutSinceTurn: TURN - 1, joinedTurn: TURN },
        { entityId: "B", share: 0, rivalShare: 90, wantsOutSinceTurn: TURN - 1, joinedTurn: TURN },
      ],
      TURN
    );
    expect(worst.stress).toBeGreaterThan(0);
    expect(worst.stress).toBeLessThanOrEqual(1);
    expect(blocStressLabel(worst.stress)).toBe("Overextended");
  });

  describe("effectiveness", () => {
    // A dampener that can zero a player's action reads as broken, not as
    // pressure. Maximum strain is an impairment, not paralysis.
    it("never zeroes a bloc's plays", () => {
      expect(blocPlayEffectiveness(1)).toBeCloseTo(1 - STRESS_MAX_DAMPING, 9);
      expect(blocPlayEffectiveness(1)).toBeGreaterThan(0.5);
    });

    it("is monotonic and clamped", () => {
      let prev = Infinity;
      for (const s of [0, 0.25, 0.5, 0.75, 1]) {
        const e = blocPlayEffectiveness(s);
        expect(e).toBeLessThanOrEqual(prev);
        prev = e;
      }
      expect(blocPlayEffectiveness(-5)).toBe(1);
      expect(blocPlayEffectiveness(99)).toBeCloseTo(1 - STRESS_MAX_DAMPING, 9);
      expect(blocPlayEffectiveness(NaN)).toBe(1);
    });
  });

  it("labels every band it can produce", () => {
    expect(blocStressLabel(0)).toBe("Settled");
    expect(blocStressLabel(0.4)).toBe("Strained");
    expect(blocStressLabel(0.9)).toBe("Overextended");
  });
});

// The calibration test this module should have had from the start. The unit
// tests above all used a hand-made `share: 95` fixture, so a threshold that was
// badly wrong against the game's OWN seed rosters passed everything: every world
// opened Strained, with NATO permanently docked relative to the Warsaw Pact,
// purely from authored data and before any player acted.
describe("calibration against the real 1953 seeds", () => {
  const era = AUTHORED_ALIGNMENT["1953-default"];
  // [WEST, EAST] in the authored pair.
  const rosters: Array<{ bloc: string; poleIdx: 0 | 1; members: string[] }> = [
    { bloc: "NATO", poleIdx: 0, members: ["US", "UK", "FR", "IT", "CA", "TR", "GR", "DE"] },
    { bloc: "WARSAW_PACT", poleIdx: 1, members: ["RU", "PL", "HU", "RO", "BG", "CS", "DD"] },
  ];

  function stressFor(poleIdx: 0 | 1, members: string[], turn: number) {
    return computeBlocStress(
      members
        .filter((cc) => era[cc])
        .map((cc) => ({
          entityId: cc,
          share: era[cc][poleIdx] ?? 0,
          rivalShare: era[cc][poleIdx === 0 ? 1 : 0] ?? 0,
          wantsOutSinceTurn: null,
          // Seeders stamp founding members with turn 0.
          joinedTurn: 0,
        })),
      turn
    );
  }

  it("opens every bloc Settled on a fresh world", () => {
    for (const r of rosters) {
      const b = stressFor(r.poleIdx, r.members, 1);
      expect(b.memberCount, `${r.bloc} roster`).toBeGreaterThan(2);
      expect(blocStressLabel(b.stress), `${r.bloc} at turn 1`).toBe("Settled");
    }
  });

  it("does not count founding members as digestion", () => {
    for (const r of rosters) {
      expect(stressFor(r.poleIdx, r.members, 1).digesting, r.bloc).toBe(0);
    }
  });

  // The asymmetry that made this a silent West-vs-East balance tilt.
  it("does not favour one bloc over the other at seed", () => {
    const [west, east] = rosters.map((r) => stressFor(r.poleIdx, r.members, 1).stress);
    expect(Math.abs(west - east), "seed-day stress gap between blocs").toBeLessThan(0.1);
  });
});
