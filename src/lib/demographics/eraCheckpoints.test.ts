import { describe, expect, it } from "vitest";
import {
  applyCheckpointStep,
  applyCounterPressure,
  computeCheckpointRawDelta,
  isCheckpointActive,
  resolveCheckpointStartTurn,
  SOUTHERN_REALIGNMENT_CHECKPOINT,
  ERA_CHECKPOINTS,
  ALL_US_STATES,
  MIDWEST_STATES,
  type EraCheckpoint,
  type EraCheckpointTarget,
  type DocketCaseLookupEntry,
} from "./eraCheckpoints";

const BASE_CHECKPOINT: EraCheckpoint = {
  id: "test-checkpoint",
  countryId: "US",
  title: "Test Checkpoint",
  triggerCaseKey: "test-case-1954",
  fallbackStartTurn: 500,
  durationTurns: 100,
  targets: [
    { dim: "race", bucket: "white", stateIds: ["AL"], axis: "economicLean", totalShift: 4.0 },
  ],
};

describe("resolveCheckpointStartTurn", () => {
  it("uses the fallback when the checkpoint has no trigger case", () => {
    const checkpoint: EraCheckpoint = { ...BASE_CHECKPOINT, triggerCaseKey: undefined };
    expect(resolveCheckpointStartTurn(checkpoint, undefined)).toBe(500);
  });

  it("uses the fallback when the trigger case hasn't been decided yet", () => {
    const pending: DocketCaseLookupEntry = { status: "pending" };
    expect(resolveCheckpointStartTurn(BASE_CHECKPOINT, pending)).toBe(500);
  });

  it("uses the fallback when the docket case is missing entirely", () => {
    expect(resolveCheckpointStartTurn(BASE_CHECKPOINT, undefined)).toBe(500);
  });

  it("starts at decidedAtTurn when the case affirms the historical ruling", () => {
    const affirmed: DocketCaseLookupEntry = {
      status: "decided",
      outcome: "affirmed",
      decidedAtTurn: 49,
    };
    expect(resolveCheckpointStartTurn(BASE_CHECKPOINT, affirmed)).toBe(49);
  });

  it("falls back (does not start early) when the case diverges from history", () => {
    // A differently-composed Court upholding segregation doesn't cancel the
    // realignment outright — it just doesn't get credit for kicking it off early.
    const diverged: DocketCaseLookupEntry = {
      status: "decided",
      outcome: "diverged",
      decidedAtTurn: 49,
    };
    expect(resolveCheckpointStartTurn(BASE_CHECKPOINT, diverged)).toBe(500);
  });

  it("falls back defensively if a decided case is somehow missing decidedAtTurn", () => {
    const malformed: DocketCaseLookupEntry = { status: "decided", outcome: "affirmed" };
    expect(resolveCheckpointStartTurn(BASE_CHECKPOINT, malformed)).toBe(500);
  });
});

describe("isCheckpointActive", () => {
  it("is inactive before the start turn", () => {
    expect(isCheckpointActive(BASE_CHECKPOINT, 100, 99)).toBe(false);
  });

  it("is active on the start turn", () => {
    expect(isCheckpointActive(BASE_CHECKPOINT, 100, 100)).toBe(true);
  });

  it("is active mid-window", () => {
    expect(isCheckpointActive(BASE_CHECKPOINT, 100, 150)).toBe(true);
  });

  it("is inactive exactly at the window's end turn (exclusive)", () => {
    expect(isCheckpointActive(BASE_CHECKPOINT, 100, 200)).toBe(false);
  });

  it("is active on the last turn inside the window", () => {
    expect(isCheckpointActive(BASE_CHECKPOINT, 100, 199)).toBe(true);
  });
});

describe("computeCheckpointRawDelta", () => {
  it("divides totalShift evenly across durationTurns", () => {
    const target = BASE_CHECKPOINT.targets[0];
    expect(computeCheckpointRawDelta(target, BASE_CHECKPOINT)).toBeCloseTo(4.0 / 100, 10);
  });

  it("returns 0 for a zero-or-negative duration (defensive)", () => {
    const zeroDuration: EraCheckpoint = { ...BASE_CHECKPOINT, durationTurns: 0 };
    expect(computeCheckpointRawDelta(BASE_CHECKPOINT.targets[0], zeroDuration)).toBe(0);
  });
});

describe("applyCounterPressure", () => {
  it("passes the raw delta through unchanged with no counter-shift", () => {
    expect(applyCounterPressure(0.05, 0)).toBe(0.05);
  });

  it("ignores same-direction pressure (reinforcing legislation doesn't double-count here)", () => {
    expect(applyCounterPressure(0.05, 0.02)).toBe(0.05);
  });

  it("reduces the raw delta when opposing pressure is smaller in magnitude", () => {
    const net = applyCounterPressure(0.05, -0.02);
    expect(net).toBeCloseTo(0.03, 10);
    expect(net).toBeGreaterThan(0);
  });

  it("fully cancels the raw delta when opposing pressure matches in magnitude", () => {
    expect(applyCounterPressure(0.05, -0.05)).toBeCloseTo(0, 10);
  });

  it("reverses the raw delta when opposing pressure exceeds it — a player CAN beat the tide", () => {
    const net = applyCounterPressure(0.05, -0.2);
    expect(net).toBeLessThan(0);
  });

  it("returns 0 unchanged when the raw delta is already 0", () => {
    expect(applyCounterPressure(0, -5)).toBe(0);
  });
});

describe("applyCheckpointStep", () => {
  it("adds the delta to the current value", () => {
    expect(applyCheckpointStep(-2, 0.5)).toBeCloseTo(-1.5, 10);
  });

  it("is a no-op for a zero delta", () => {
    expect(applyCheckpointStep(3, 0)).toBe(3);
  });

  it("clamps at the axis ceiling", () => {
    expect(applyCheckpointStep(4.8, 1)).toBe(5);
  });

  it("clamps at the axis floor", () => {
    expect(applyCheckpointStep(-4.8, -1)).toBe(-5);
  });
});

describe("Southern realignment checkpoint — simulated span", () => {
  const checkpoint = SOUTHERN_REALIGNMENT_CHECKPOINT;
  const target = checkpoint.targets.find(
    (t) => t.dim === "race" && t.bucket === "white" && t.axis === "economicLean"
  )!;
  // Deep South whites start Democratic-leaning per the 1953 seed's
  // STATE_POSITION_OVERRIDES (party-registration anchor).
  const SEEDED_DEEP_SOUTH_LEAN = -2.0;

  it("moves the base lean rightward (historically correct direction) over the full window when uncontested", () => {
    const rawDelta = computeCheckpointRawDelta(target, checkpoint);
    expect(rawDelta).toBeGreaterThan(0); // Republican-ward, matching the historical defection

    let lean = SEEDED_DEEP_SOUTH_LEAN;
    const samples: number[] = [lean];
    for (let turn = 0; turn < checkpoint.durationTurns; turn++) {
      const net = applyCounterPressure(rawDelta, 0);
      lean = applyCheckpointStep(lean, net);
      samples.push(lean);
    }

    // Strictly increasing (rightward) every turn, no reversal.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
    // Reaches (within floating point) the full authored shift.
    expect(lean).toBeCloseTo(SEEDED_DEEP_SOUTH_LEAN + target.totalShift, 6);
    // And it actually crosses from Democratic-leaning to Republican-leaning —
    // the real-world signature of the realignment.
    expect(SEEDED_DEEP_SOUTH_LEAN).toBeLessThan(0);
    expect(lean).toBeGreaterThan(0);
  });

  it("is beatable: a sustained, sufficiently strong countervailing push holds the state", () => {
    const rawDelta = computeCheckpointRawDelta(target, checkpoint);
    // A player pouring sustained opposing legislative effort into the state —
    // modeled here as a constant per-turn counter-shift bigger than the
    // checkpoint's own pull.
    const counterShiftPerTurn = -rawDelta * 1.5;

    let lean = SEEDED_DEEP_SOUTH_LEAN;
    for (let turn = 0; turn < checkpoint.durationTurns; turn++) {
      const net = applyCounterPressure(rawDelta, counterShiftPerTurn);
      lean = applyCheckpointStep(lean, net);
    }

    // The countervailing force didn't just slow the drift — it held (and
    // pushed past) the starting position, i.e. the tide was beaten, not merely
    // dampened.
    expect(lean).toBeLessThanOrEqual(SEEDED_DEEP_SOUTH_LEAN);
  });

  it("a moderate (partial) countervailing push slows, but does not fully beat, the drift", () => {
    const rawDelta = computeCheckpointRawDelta(target, checkpoint);
    const partialCounter = -rawDelta * 0.5; // half-strength opposition

    let uncontested = SEEDED_DEEP_SOUTH_LEAN;
    let contested = SEEDED_DEEP_SOUTH_LEAN;
    for (let turn = 0; turn < checkpoint.durationTurns; turn++) {
      uncontested = applyCheckpointStep(uncontested, applyCounterPressure(rawDelta, 0));
      contested = applyCheckpointStep(contested, applyCounterPressure(rawDelta, partialCounter));
    }

    // Still moves right (history isn't fully cancelled)...
    expect(contested).toBeGreaterThan(SEEDED_DEEP_SOUTH_LEAN);
    // ...but measurably less far than the uncontested run.
    expect(contested).toBeLessThan(uncontested);
  });
});

describe("ALL_US_STATES / MIDWEST_STATES", () => {
  it("ALL_US_STATES has all 50 states, no duplicates", () => {
    expect(ALL_US_STATES.length).toBe(50);
    expect(new Set(ALL_US_STATES).size).toBe(50);
  });

  it("MIDWEST_STATES is a subset of ALL_US_STATES with no duplicates", () => {
    expect(new Set(MIDWEST_STATES).size).toBe(MIDWEST_STATES.length);
    for (const s of MIDWEST_STATES) {
      expect(ALL_US_STATES).toContain(s);
    }
  });
});

describe("EraCheckpointTarget shape — every registered checkpoint's targets are well-formed", () => {
  function isBucketTarget(t: EraCheckpointTarget): boolean {
    return typeof t.dim === "string" && typeof t.bucket === "string";
  }
  it("every target is a bucket target (dim + bucket), with no archetype targets left", () => {
    for (const checkpoint of ERA_CHECKPOINTS) {
      for (const target of checkpoint.targets) {
        expect(
          isBucketTarget(target),
          `${checkpoint.id}: target must be a bucket target, got dim=${target.dim} bucket=${target.bucket}`
        ).toBe(true);
        expect(
          "groupId" in target,
          `${checkpoint.id}: archetype targets were removed; found a stray groupId`
        ).toBe(false);
      }
    }
  });

  it("every target has a non-empty stateIds list and a non-zero totalShift", () => {
    for (const checkpoint of ERA_CHECKPOINTS) {
      for (const target of checkpoint.targets) {
        expect(
          target.stateIds.length,
          `${checkpoint.id} has an empty stateIds list`
        ).toBeGreaterThan(0);
        expect(target.totalShift, `${checkpoint.id} has a zero totalShift target`).not.toBe(0);
      }
    }
  });

  it("a checkpoint with no triggerCaseKey (a designated permanent STATUTE, not a ruling) is a real, working marking convention", () => {
    // NATIONAL_CIVIL_RIGHTS_ACT_CHECKPOINT is this project's worked example:
    // no docket case gates it at all, unlike every SCOTUS-triggered entry.
    const statuteCheckpoints = ERA_CHECKPOINTS.filter((c) => !c.triggerCaseKey);
    expect(statuteCheckpoints.length).toBeGreaterThan(0);
    for (const c of statuteCheckpoints) {
      // resolveCheckpointStartTurn always falls back to fallbackStartTurn
      // (there's no case outcome to consult) — this IS the intended behavior
      // for a statute, not a degrade.
      expect(resolveCheckpointStartTurn(c, undefined)).toBe(c.fallbackStartTurn);
    }
  });

  it("SOUTHERN_REALIGNMENT_CHECKPOINT's 'southern whites' bucket target uses the real race:white vocabulary, not an invented category", () => {
    const target = SOUTHERN_REALIGNMENT_CHECKPOINT.targets.find(
      (t) => t.dim === "race" && t.bucket === "white"
    );
    expect(target).toBeDefined();
    expect(target!.stateIds).toEqual(expect.arrayContaining(["AL", "MS", "SC", "LA", "GA", "AR"]));
  });
});
