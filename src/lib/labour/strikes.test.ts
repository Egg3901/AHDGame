import { describe, expect, it } from "vitest";
import {
  trendWorkerExpectation,
  stepStrike,
  lawAdjustedUnionizationThreshold,
  WORKER_EXPECTATION_TREND_STEP,
  STRIKE_UNIONIZATION_THRESHOLD,
  STRIKE_EXPECTATION_GAP_THRESHOLD,
  STRIKE_CONCESSION_GAP_THRESHOLD,
  STRIKE_DURATION_TURNS,
  STRIKE_COOLDOWN_TURNS,
  STRIKE_WAITOUT_UNIONIZATION_BUMP,
  STRIKE_LAW_THRESHOLD_WEIGHT,
} from "./strikes";
import { MAX_STRIKE_SOFTENING } from "@/lib/unions/unionServices";

describe("trendWorkerExpectation", () => {
  it("initializes at realWage with no prior value (no first-turn gap)", () => {
    expect(trendWorkerExpectation(undefined, 0.8)).toBe(0.8);
  });

  it("steps toward realWage by at most WORKER_EXPECTATION_TREND_STEP", () => {
    const out = trendWorkerExpectation(1.0, 0.5);
    expect(out).toBeCloseTo(1.0 - WORKER_EXPECTATION_TREND_STEP, 9);
  });

  it("steps up toward a higher realWage", () => {
    const out = trendWorkerExpectation(0.8, 1.2);
    expect(out).toBeCloseTo(0.8 + WORKER_EXPECTATION_TREND_STEP, 9);
  });

  it("never overshoots when the remaining distance is smaller than the step", () => {
    const out = trendWorkerExpectation(1.0 - WORKER_EXPECTATION_TREND_STEP / 2, 1.0);
    expect(out).toBe(1.0);
  });

  it("is a no-op exactly at realWage", () => {
    expect(trendWorkerExpectation(1.0, 1.0)).toBe(1.0);
  });
});

const NOT_STRIKING = { strikeStartedAtTurn: null, strikeCooldownUntilTurn: null };
const HIGH_UNIONIZATION = STRIKE_UNIONIZATION_THRESHOLD + 5;
const WIDE_GAP = STRIKE_EXPECTATION_GAP_THRESHOLD + 0.1; // workerExpectation - realWage

describe("stepStrike, trigger", () => {
  it("triggers when unionization and gap both exceed their thresholds, out of cooldown", () => {
    const result = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
    });
    expect(result.event).toBe("started");
    expect(result.next.strikeStartedAtTurn).toBe(10);
    expect(result.next.strikeCooldownUntilTurn).toBeNull();
  });

  it("does not trigger when unionization is at or below the threshold", () => {
    const result = stepStrike({
      unionization: STRIKE_UNIONIZATION_THRESHOLD,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
    });
    expect(result.event).toBeNull();
    expect(result.next).toBe(NOT_STRIKING);
  });

  it("does not trigger when the gap is at or below the trigger threshold", () => {
    const result = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + STRIKE_EXPECTATION_GAP_THRESHOLD,
      turn: 10,
      prior: NOT_STRIKING,
    });
    expect(result.event).toBeNull();
  });

  it("does not trigger while in cooldown even if conditions otherwise qualify", () => {
    const result = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: { strikeStartedAtTurn: null, strikeCooldownUntilTurn: 11 },
    });
    expect(result.event).toBeNull();
    expect(result.next.strikeStartedAtTurn).toBeNull();
  });

  it("triggers again exactly once cooldown has elapsed", () => {
    const result = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 11,
      prior: { strikeStartedAtTurn: null, strikeCooldownUntilTurn: 11 },
    });
    expect(result.event).toBe("started");
  });
});

describe("stepStrike, resolution", () => {
  it("resolves via concession when the gap closes to at or below the concession threshold", () => {
    const result = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 1.0,
      // Strictly below the threshold (not exactly at it) to avoid a
      // floating-point boundary flake in the `<=` comparison.
      workerExpectation: 1.0 + STRIKE_CONCESSION_GAP_THRESHOLD - 0.001,
      turn: 5,
      prior: { strikeStartedAtTurn: 2, strikeCooldownUntilTurn: null },
    });
    expect(result.event).toBe("resolved_concession");
    expect(result.next.strikeStartedAtTurn).toBeNull();
    expect(result.next.strikeCooldownUntilTurn).toBe(5 + STRIKE_COOLDOWN_TURNS);
    expect(result.unionizationBump).toBe(0);
  });

  it("resolves via concession even before STRIKE_DURATION_TURNS has elapsed", () => {
    const result = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 1.0,
      workerExpectation: 1.0,
      turn: 3, // only 1 turn elapsed since strikeStartedAtTurn: 2
      prior: { strikeStartedAtTurn: 2, strikeCooldownUntilTurn: null },
    });
    expect(result.event).toBe("resolved_concession");
  });

  it("resolves via wait-it-out at exactly STRIKE_DURATION_TURNS elapsed, with the unionization bump and cooldown set", () => {
    const startTurn = 2;
    const result = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP, // gap still wide, no concession
      turn: startTurn + STRIKE_DURATION_TURNS,
      prior: { strikeStartedAtTurn: startTurn, strikeCooldownUntilTurn: null },
    });
    expect(result.event).toBe("resolved_waitout");
    expect(result.next.strikeStartedAtTurn).toBeNull();
    expect(result.next.strikeCooldownUntilTurn).toBe(
      startTurn + STRIKE_DURATION_TURNS + STRIKE_COOLDOWN_TURNS
    );
    expect(result.unionizationBump).toBe(STRIKE_WAITOUT_UNIONIZATION_BUMP);
  });

  it("stays active before STRIKE_DURATION_TURNS elapses with no concession", () => {
    const startTurn = 2;
    const result = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: startTurn + STRIKE_DURATION_TURNS - 1,
      prior: { strikeStartedAtTurn: startTurn, strikeCooldownUntilTurn: null },
    });
    expect(result.event).toBeNull();
    expect(result.next.strikeStartedAtTurn).toBe(startTurn);
  });

  it("regression: passive expectation decay alone (no wage change) resolves via waitout, never concession", () => {
    // Pins the documented boundary: (TRIGGER - CONCESSION) == STRIKE_DURATION_TURNS * WORKER_EXPECTATION_TREND_STEP.
    // Seed the gap just above the trigger threshold, then simulate
    // STRIKE_DURATION_TURNS turns of passive trendWorkerExpectation decay
    // with realWage held flat (no CEO wage action) and re-check stepStrike
    // at each turn, it must never resolve via concession before duration expires.
    const realWage = 0.8;
    let workerExpectation = realWage + STRIKE_EXPECTATION_GAP_THRESHOLD + 0.001;
    const startTurn = 0;
    let state: { strikeStartedAtTurn: number | null; strikeCooldownUntilTurn: number | null } = {
      strikeStartedAtTurn: startTurn,
      strikeCooldownUntilTurn: null,
    };

    for (let t = 1; t <= STRIKE_DURATION_TURNS; t++) {
      workerExpectation = trendWorkerExpectation(workerExpectation, realWage);
      const result = stepStrike({
        unionization: HIGH_UNIONIZATION,
        realWage,
        workerExpectation,
        turn: startTurn + t,
        prior: state,
      });
      if (t < STRIKE_DURATION_TURNS) {
        expect(result.event).toBeNull();
      } else {
        expect(result.event).toBe("resolved_waitout");
      }
      state = result.next;
    }
  });
});

describe("stepStrike, v3 Phase 7b threshold overrides", () => {
  it("defaults to the module constant when unionizationThreshold is omitted", () => {
    const result = stepStrike({
      unionization: STRIKE_UNIONIZATION_THRESHOLD - 1, // below the default threshold
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
    });
    expect(result.event).toBeNull();
  });

  it("uses a lowered override threshold to trigger where the default would not", () => {
    const lowered = STRIKE_UNIONIZATION_THRESHOLD - 10;
    const result = stepStrike({
      unionization: STRIKE_UNIONIZATION_THRESHOLD - 5, // below default, above the override
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
      unionizationThreshold: lowered,
    });
    expect(result.event).toBe("started");
  });

  it("uses a raised override threshold to suppress a trigger the default would allow", () => {
    const raised = STRIKE_UNIONIZATION_THRESHOLD + 10;
    const result = stepStrike({
      unionization: STRIKE_UNIONIZATION_THRESHOLD + 5, // above default, below the override
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
      unionizationThreshold: raised,
    });
    expect(result.event).toBeNull();
  });

  it("does not affect the concession/waitout resolution thresholds", () => {
    // Even with a very low trigger threshold override, an already-active
    // strike's concession/waitout logic is unaffected.
    const result = stepStrike({
      unionization: 90,
      realWage: 1.0,
      workerExpectation: 1.0 + STRIKE_CONCESSION_GAP_THRESHOLD - 0.001,
      turn: 5,
      prior: { strikeStartedAtTurn: 2, strikeCooldownUntilTurn: null },
      unionizationThreshold: 0,
    });
    expect(result.event).toBe("resolved_concession");
  });
});

describe("lawAdjustedUnionizationThreshold", () => {
  it("returns the base threshold at bias 0 / absent", () => {
    expect(lawAdjustedUnionizationThreshold(0)).toBe(STRIKE_UNIONIZATION_THRESHOLD);
    expect(lawAdjustedUnionizationThreshold(undefined)).toBe(STRIKE_UNIONIZATION_THRESHOLD);
  });

  it("positive (collective-bargaining) bias lowers the threshold", () => {
    expect(lawAdjustedUnionizationThreshold(20)).toBeCloseTo(
      STRIKE_UNIONIZATION_THRESHOLD - 20 * STRIKE_LAW_THRESHOLD_WEIGHT,
      9
    );
  });

  it("negative (right-to-work) bias raises the threshold", () => {
    expect(lawAdjustedUnionizationThreshold(-20)).toBeCloseTo(
      STRIKE_UNIONIZATION_THRESHOLD + 20 * STRIKE_LAW_THRESHOLD_WEIGHT,
      9
    );
  });

  it("treats non-finite bias as neutral", () => {
    expect(lawAdjustedUnionizationThreshold(NaN)).toBe(STRIKE_UNIONIZATION_THRESHOLD);
  });
});

describe("stepStrike, union ban (player suggestion #93)", () => {
  it("never triggers a strike while unions are banned, even at maximal trigger conditions", () => {
    const result = stepStrike({
      unionization: 100,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
      unionsBanned: true,
    });
    expect(result.event).toBeNull();
    expect(result.next).toBe(NOT_STRIKING);
    expect(result.unionizationBump).toBe(0);
  });

  it("force-resolves an active strike as resolved_banned with the standard cooldown and no radicalization bump", () => {
    const result = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP, // gap wide open, would NOT resolve by concession
      turn: 12,
      prior: { strikeStartedAtTurn: 11, strikeCooldownUntilTurn: null }, // 1 turn elapsed, would NOT resolve by waitout
      unionsBanned: true,
    });
    expect(result.event).toBe("resolved_banned");
    expect(result.next.strikeStartedAtTurn).toBeNull();
    expect(result.next.strikeCooldownUntilTurn).toBe(12 + STRIKE_COOLDOWN_TURNS);
    expect(result.unionizationBump).toBe(0);
  });

  it("unionsBanned: false behaves identically to omitting the flag (trigger fires)", () => {
    const banned = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
      unionsBanned: false,
    });
    expect(banned.event).toBe("started");
    expect(banned.next.strikeStartedAtTurn).toBe(10);
  });

  it("blocks new strikes and resolves an active strike under a collective agreement", () => {
    const blocked = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
      noStrikeProtected: true,
    });
    expect(blocked.event).toBeNull();
    expect(blocked.next).toEqual(NOT_STRIKING);

    const resolved = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 12,
      prior: { strikeStartedAtTurn: 11, strikeCooldownUntilTurn: null },
      noStrikeProtected: true,
    });
    expect(resolved.event).toBe("resolved_agreement");
    expect(resolved.next.strikeStartedAtTurn).toBeNull();
    expect(resolved.next.strikeCooldownUntilTurn).toBe(12 + STRIKE_COOLDOWN_TURNS);
    expect(resolved.unionizationBump).toBe(0);
  });
});

describe("stepStrike, union dues v1: representing-union service softening", () => {
  it("a softened gap can keep a strike from triggering where an unsoftened one would fire", () => {
    const unsoftened = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      // Just over the trigger threshold, softening it down should drop it
      // back under the threshold.
      workerExpectation: 0.8 + STRIKE_EXPECTATION_GAP_THRESHOLD + 0.01,
      turn: 10,
      prior: NOT_STRIKING,
    });
    expect(unsoftened.event).toBe("started");

    const softened = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + STRIKE_EXPECTATION_GAP_THRESHOLD + 0.01,
      turn: 10,
      prior: NOT_STRIKING,
      strikeSoftening: 0.5,
    });
    expect(softened.event).toBeNull();
  });

  it("softening also helps an active strike reach concession sooner", () => {
    const stillActive = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 1.0,
      workerExpectation: 1.0 + STRIKE_CONCESSION_GAP_THRESHOLD + 0.01,
      turn: 5,
      prior: { strikeStartedAtTurn: 2, strikeCooldownUntilTurn: null },
    });
    expect(stillActive.event).toBeNull(); // gap not yet closed enough to concede

    const concedes = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 1.0,
      workerExpectation: 1.0 + STRIKE_CONCESSION_GAP_THRESHOLD + 0.01,
      turn: 5,
      prior: { strikeStartedAtTurn: 2, strikeCooldownUntilTurn: null },
      strikeSoftening: 0.5,
    });
    expect(concedes.event).toBe("resolved_concession");
  });

  it("never fully zeroes the gap even at the maximum softening a service slate can reach, services must not make a sector strike-proof", () => {
    const result = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      // A gap so wide that even damping it by MAX_STRIKE_SOFTENING (0.6)
      // still clears the trigger threshold.
      workerExpectation: 0.8 + STRIKE_EXPECTATION_GAP_THRESHOLD * 10,
      turn: 10,
      prior: NOT_STRIKING,
      strikeSoftening: MAX_STRIKE_SOFTENING,
    });
    expect(result.event).toBe("started");
  });

  it("absent/non-finite strikeSoftening behaves exactly like 0 (no softening)", () => {
    const omitted = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
    });
    const explicitZero = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
      strikeSoftening: 0,
    });
    const nonFinite = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
      strikeSoftening: Number.NaN,
    });
    expect(omitted).toEqual(explicitZero);
    expect(nonFinite).toEqual(explicitZero);
  });

  it("clamps an out-of-range strikeSoftening into [0,1]", () => {
    const over = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
      strikeSoftening: 5,
    });
    const atOne = stepStrike({
      unionization: HIGH_UNIONIZATION,
      realWage: 0.8,
      workerExpectation: 0.8 + WIDE_GAP,
      turn: 10,
      prior: NOT_STRIKING,
      strikeSoftening: 1,
    });
    expect(over).toEqual(atOne);
  });
});
