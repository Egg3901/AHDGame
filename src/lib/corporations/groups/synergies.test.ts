import { describe, it, expect } from "vitest";
import {
  GROUP_SYNERGY_CONVERGENCE,
  GROUP_SYNERGY_MAX_SHARE,
  SPINOFF_BRAND_INHERITANCE_TURNS,
  SPINOFF_SYNERGY_MAX_SHARE,
  computeGroupSynergies,
  memberShareCap,
  type SynergyMember,
} from "./synergies";

const member = (over: Partial<SynergyMember> & { corporationId: string }): SynergyMember => ({
  marketingStrength: 0,
  logisticsStrength: 0,
  ...over,
});

describe("computeGroupSynergies", () => {
  it("lifts a weak member toward the group's best", () => {
    const deltas = computeGroupSynergies(
      [
        member({ corporationId: "strong", marketingStrength: 100, logisticsStrength: 100 }),
        member({ corporationId: "weak", marketingStrength: 0, logisticsStrength: 0 }),
      ],
      100
    );
    const weak = deltas.find((d) => d.corporationId === "weak")!;
    // Target is 60% of 100; 5% of that gap closes this turn.
    expect(weak.marketingStrength).toBeCloseTo(
      100 * GROUP_SYNERGY_MAX_SHARE * GROUP_SYNERGY_CONVERGENCE,
      2
    );
  });

  it("NEVER reduces a member — synergy is a floor, not an average", () => {
    // This is the property the whole design turns on. Averaging would mean
    // acquiring a weak subsidiary drags the parent down, so the optimal play
    // would be to never group anything.
    const deltas = computeGroupSynergies(
      [
        member({ corporationId: "strong", marketingStrength: 100, logisticsStrength: 100 }),
        member({ corporationId: "weak", marketingStrength: 1, logisticsStrength: 1 }),
      ],
      100
    );
    for (const delta of deltas) {
      expect(delta.marketingStrength).toBeGreaterThanOrEqual(0);
      expect(delta.logisticsStrength).toBeGreaterThanOrEqual(0);
    }
    expect(deltas.find((d) => d.corporationId === "strong")).toBeUndefined();
  });

  it("does not lift a member already above the capped share", () => {
    // 70 is above 60% of the 100 leader, so this member gains nothing.
    const deltas = computeGroupSynergies(
      [
        member({ corporationId: "leader", marketingStrength: 100, logisticsStrength: 100 }),
        member({ corporationId: "already-good", marketingStrength: 70, logisticsStrength: 70 }),
      ],
      100
    );
    expect(deltas.find((d) => d.corporationId === "already-good")).toBeUndefined();
  });

  it("writes nothing for a settled group", () => {
    const deltas = computeGroupSynergies(
      [
        member({ corporationId: "a", marketingStrength: 100, logisticsStrength: 100 }),
        member({ corporationId: "b", marketingStrength: 100, logisticsStrength: 100 }),
      ],
      100
    );
    expect(deltas).toEqual([]);
  });

  it("does nothing for a lone corporation", () => {
    expect(
      computeGroupSynergies([member({ corporationId: "a", marketingStrength: 100 })], 100)
    ).toEqual([]);
  });

  it("does nothing for a group with no capability to share", () => {
    expect(
      computeGroupSynergies([member({ corporationId: "a" }), member({ corporationId: "b" })], 100)
    ).toEqual([]);
  });

  it("treats malformed strengths as zero rather than propagating NaN", () => {
    const deltas = computeGroupSynergies(
      [
        member({ corporationId: "leader", marketingStrength: 100 }),
        member({ corporationId: "broken", marketingStrength: Number.NaN as number }),
      ],
      100
    );
    for (const delta of deltas) {
      expect(Number.isFinite(delta.marketingStrength)).toBe(true);
    }
  });
});

describe("memberShareCap — the spin-off inheritance window", () => {
  const groupIds = new Set(["parent", "spun"]);

  it("gives a recent spin-off the raised ceiling", () => {
    const cap = memberShareCap(
      member({
        corporationId: "spun",
        isSpinOff: true,
        spunOffFromCorpId: "parent",
        spunOffAtTurn: 100,
      }),
      groupIds,
      100 + SPINOFF_BRAND_INHERITANCE_TURNS
    );
    expect(cap).toBe(SPINOFF_SYNERGY_MAX_SHARE);
  });

  it("drops to the ordinary ceiling once the window closes", () => {
    const cap = memberShareCap(
      member({
        corporationId: "spun",
        isSpinOff: true,
        spunOffFromCorpId: "parent",
        spunOffAtTurn: 100,
      }),
      groupIds,
      100 + SPINOFF_BRAND_INHERITANCE_TURNS + 1
    );
    expect(cap).toBe(GROUP_SYNERGY_MAX_SHARE);
  });

  it("drops to the ordinary ceiling when the origin corp has left the group", () => {
    // The advantage is continuity with the business it came from. If that
    // business is no longer in the group, there is nothing to be continuous
    // with.
    const cap = memberShareCap(
      member({
        corporationId: "spun",
        isSpinOff: true,
        spunOffFromCorpId: "gone",
        spunOffAtTurn: 100,
      }),
      groupIds,
      101
    );
    expect(cap).toBe(GROUP_SYNERGY_MAX_SHARE);
  });

  it("gives an ordinary acquired member the ordinary ceiling", () => {
    expect(memberShareCap(member({ corporationId: "bought" }), groupIds, 100)).toBe(
      GROUP_SYNERGY_MAX_SHARE
    );
  });

  it("falls back to the ordinary ceiling for a spin-off with no recorded turn", () => {
    // Pre-C6 spin-offs carry no `spunOffAtTurn`. Fail closed rather than
    // granting an unbounded inheritance window to legacy data.
    expect(
      memberShareCap(
        member({ corporationId: "spun", isSpinOff: true, spunOffFromCorpId: "parent" }),
        groupIds,
        100
      )
    ).toBe(GROUP_SYNERGY_MAX_SHARE);
  });
});
