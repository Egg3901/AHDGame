/**
 * Tests for the shared durable base-value relocation primitives (lean AND
 * turnout channels). See the module doc comment for the full design writeup:
 * era checkpoints, the SCOTUS demographic-signal consumer, and designated
 * ("permanent") legislation all funnel through these same pure functions so
 * a durable shift reaches both vote paths identically.
 */
import { describe, it, expect } from "vitest";
import type { StateDemographics } from "@/lib/db/types/demographics";
import {
  applyDurableStep,
  applyDurableGroupShift,
  applyDurableBucketShift,
  readLayer1Overlay,
  applyDurableTurnoutStep,
  applyDurableGroupTurnoutShift,
  applyDurableBucketTurnoutShift,
  readLayer1TurnoutOverlay,
  type DurableShiftAccumulators,
} from "./durableRealignment";

function makeAcc(): DurableShiftAccumulators {
  return { liveUpdates: {}, defaultUpdates: {} };
}

describe("applyDurableStep (lean axis, -5..5)", () => {
  it("is a no-op for a zero delta", () => {
    expect(applyDurableStep(1.2, 0)).toBe(1.2);
  });
  it("clamps to the shared -5..5 axis", () => {
    expect(applyDurableStep(4.5, 3)).toBe(5);
    expect(applyDurableStep(-4.5, -3)).toBe(-5);
  });
});

describe("applyDurableTurnoutStep (archetype turnout, 0..100)", () => {
  it("is a no-op for a zero delta", () => {
    expect(applyDurableTurnoutStep(55, 0)).toBe(55);
  });
  it("clamps to the real 0-100 percentage scale — NOT the ±5 lean axis", () => {
    expect(applyDurableTurnoutStep(97, 10)).toBe(100);
    expect(applyDurableTurnoutStep(3, -10)).toBe(0);
  });
  it("does not clamp a legitimate mid-range value", () => {
    expect(applyDurableTurnoutStep(40, 15)).toBe(55);
  });
});

describe("readLayer1Overlay / readLayer1TurnoutOverlay", () => {
  it("returns 0 when the defaults doc, dim, or bucket is missing", () => {
    expect(readLayer1Overlay(null, "race", "white", "economicLean")).toBe(0);
    expect(readLayer1TurnoutOverlay(null, "race", "black")).toBe(0);
    const defaults = {
      _id: "AL",
      countryId: "US",
      categoryWeights: {},
      groups: {},
      lastUpdated: new Date(),
    } as StateDemographics;
    expect(readLayer1Overlay(defaults, "race", "white", "economicLean")).toBe(0);
    expect(readLayer1TurnoutOverlay(defaults, "race", "black")).toBe(0);
  });

  it("reads the stored value when present", () => {
    const defaults: StateDemographics = {
      _id: "AL",
      countryId: "US",
      categoryWeights: {},
      groups: {},
      lastUpdated: new Date(),
      layer1PositionOverrides: { race: { white: { economicLean: 2, socialLean: -1 } } },
      layer1TurnoutOverrides: { race: { black: 15 } },
    };
    expect(readLayer1Overlay(defaults, "race", "white", "economicLean")).toBe(2);
    expect(readLayer1Overlay(defaults, "race", "white", "socialLean")).toBe(-1);
    expect(readLayer1TurnoutOverlay(defaults, "race", "black")).toBe(15);
  });
});

describe("applyDurableGroupShift (lean, archetype-keyed)", () => {
  it("writes both live and default group keys and stacks within one turn's acc", () => {
    const acc = makeAcc();
    applyDurableGroupShift(
      "retirees",
      "economicLean",
      1,
      { live: 2, default: 2, readOverlay: () => 0 },
      acc
    );
    expect(acc.liveUpdates["groups.retirees.economicLean"]).toBe(3);
    expect(acc.defaultUpdates["groups.retirees.economicLean"]).toBe(3);

    // A second target landing on the SAME group+axis within the same turn
    // sums rather than clobbers.
    applyDurableGroupShift(
      "retirees",
      "economicLean",
      0.5,
      { live: 2, default: 2, readOverlay: () => 0 },
      acc
    );
    expect(acc.liveUpdates["groups.retirees.economicLean"]).toBe(3.5);
  });

  it("is a no-op when netDelta is 0", () => {
    const acc = makeAcc();
    applyDurableGroupShift(
      "retirees",
      "economicLean",
      0,
      { live: 2, default: 2, readOverlay: () => 0 },
      acc
    );
    expect(acc.liveUpdates).toEqual({});
    expect(acc.defaultUpdates).toEqual({});
  });

  it("skips the default write when no default value is present, but still writes live + overlay", () => {
    const acc = makeAcc();
    applyDurableGroupShift(
      "retirees",
      "economicLean",
      1,
      { live: 2, default: undefined, readOverlay: () => 0 },
      acc
    );
    expect(acc.liveUpdates["groups.retirees.economicLean"]).toBe(3);
    expect(acc.defaultUpdates["groups.retirees.economicLean"]).toBeUndefined();
    // retirees maps onto age:senior/age:mature — the overlay projection still fires.
    expect(
      Object.keys(acc.defaultUpdates).some((k) => k.startsWith("layer1PositionOverrides.age."))
    ).toBe(true);
  });
});

describe("applyDurableBucketShift (lean, exact dim/bucket)", () => {
  it("writes only the overlay key, never a live/archetype key", () => {
    const acc = makeAcc();
    applyDurableBucketShift("race", "black", "economicLean", 1.5, () => 0, acc);
    expect(acc.defaultUpdates["layer1PositionOverrides.race.black.economicLean"]).toBe(1.5);
    expect(Object.keys(acc.liveUpdates)).toHaveLength(0);
  });

  it("accumulates on top of a pre-existing overlay reader value", () => {
    const acc = makeAcc();
    applyDurableBucketShift("race", "black", "economicLean", 1, () => 2, acc);
    expect(acc.defaultUpdates["layer1PositionOverrides.race.black.economicLean"]).toBe(3);
  });
});

// ─── Turnout channel — the Voting Rights Act's mechanism ───────────────────

describe("applyDurableGroupTurnoutShift (turnout, archetype-keyed)", () => {
  it("writes groups.<id>.turnout on both live and default, clamped to 0-100 (not the lean ±5 axis)", () => {
    const acc = makeAcc();
    applyDurableGroupTurnoutShift(
      "union_trades",
      50,
      { live: 60, default: 60, readOverlay: () => 0 },
      acc
    );
    // 60 + 50 = 110, clamped to 100 — proves this uses the turnout clamp, not
    // the lean clamp (which would have clamped to 5).
    expect(acc.liveUpdates["groups.union_trades.turnout"]).toBe(100);
    expect(acc.defaultUpdates["groups.union_trades.turnout"]).toBe(100);
  });

  it("is a no-op when netDelta is 0", () => {
    const acc = makeAcc();
    applyDurableGroupTurnoutShift(
      "union_trades",
      0,
      { live: 60, default: 60, readOverlay: () => 0 },
      acc
    );
    expect(acc.liveUpdates).toEqual({});
    expect(acc.defaultUpdates).toEqual({});
  });

  it("skips the default write when no default value is present, but still writes live + bucket overlay", () => {
    const acc = makeAcc();
    applyDurableGroupTurnoutShift(
      "union_trades",
      10,
      { live: 40, default: undefined, readOverlay: () => 0 },
      acc
    );
    expect(acc.liveUpdates["groups.union_trades.turnout"]).toBe(50);
    expect(acc.defaultUpdates["groups.union_trades.turnout"]).toBeUndefined();
    // union_trades maps onto race:black/education:no_college/wealth:low —
    // the turnout-overlay projection still fires for those buckets.
    expect(
      Object.keys(acc.defaultUpdates).some((k) => k.startsWith("layer1TurnoutOverrides."))
    ).toBe(true);
    expect(acc.defaultUpdates["layer1TurnoutOverrides.race.black"]).toBeCloseTo(10 * 0.25, 8);
  });

  it("stacks multiple targets landing on the same group+turnout within one turn", () => {
    const acc = makeAcc();
    applyDurableGroupTurnoutShift(
      "union_trades",
      5,
      { live: 40, default: 40, readOverlay: () => 0 },
      acc
    );
    applyDurableGroupTurnoutShift(
      "union_trades",
      3,
      { live: 40, default: 40, readOverlay: () => 0 },
      acc
    );
    expect(acc.liveUpdates["groups.union_trades.turnout"]).toBe(48);
  });
});

describe("applyDurableBucketTurnoutShift (turnout, exact dim/bucket — the VRA checkpoint's channel)", () => {
  it("writes only the layer1TurnoutOverrides key, never a live/archetype key", () => {
    const acc = makeAcc();
    applyDurableBucketTurnoutShift("race", "black", 20, () => 0, acc);
    expect(acc.defaultUpdates["layer1TurnoutOverrides.race.black"]).toBe(20);
    expect(Object.keys(acc.liveUpdates)).toHaveLength(0);
  });

  it("accumulates on top of a pre-existing overlay reader value", () => {
    const acc = makeAcc();
    applyDurableBucketTurnoutShift("race", "black", 5, () => 10, acc);
    expect(acc.defaultUpdates["layer1TurnoutOverrides.race.black"]).toBe(15);
  });

  it("is symmetric: a sustained negative (suppression) delta accumulates below zero, not floored at 0", () => {
    const acc = makeAcc();
    applyDurableBucketTurnoutShift("race", "black", -10, () => -5, acc);
    // If this used the archetype's [0,100] clamp instead of the overlay's
    // own signed bound, -15 would have been floored to 0 — proving the
    // module's OWN documented reason for not reusing that clamp.
    expect(acc.defaultUpdates["layer1TurnoutOverrides.race.black"]).toBe(-15);
  });

  it("clamps the accumulator at its own (signed, not [0,100]) bound under an extreme run", () => {
    const acc = makeAcc();
    let overlay = 0;
    for (let i = 0; i < 50; i++) {
      applyDurableBucketTurnoutShift("race", "black", 10, () => overlay, acc);
      overlay = acc.defaultUpdates["layer1TurnoutOverrides.race.black"];
    }
    // Bounded (not runaway to 500), and well above 100 — proving it is NOT
    // clamped to the [0, 100] absolute turnout scale.
    expect(overlay).toBeLessThan(500);
    expect(overlay).toBeGreaterThan(50);
  });
});
