/**
 * Primary calendar + vote-share momentum unit tests.
 *
 * Covers, without a live DB, the load-bearing invariants of the stretched
 * calendar + momentum subsystem:
 *   1. Core bug fix — on the stretched calendar exactly ONE wave becomes due at
 *      each scheduled offset and ZERO new waves fire in the gap turns between
 *      offsets (the compressed defect bunched all six into the final six turns).
 *   2. Momentum math — accumulates, halves via decay, and clamps to +-cap,
 *      through the SAME exported helpers the engine runs.
 *   3. Cap 0 — the vote path is byte-identical to the no-momentum engine
 *      (multiplier is exactly 1; accumulated momentum stays 0).
 *   4. v1 protection — a v1 (unstamped, compressed) race never enables momentum,
 *      and a non-presidential race never enters the stagger path at all.
 */
import { describe, it, expect } from "vitest";
import {
  getDuePrimaryWaveCount,
  momentumMultiplier,
  momentumEnabledForRuleset,
  waveMomentumPoints,
  accumulateMomentum,
  runPrimaryStaggerWaveIfDue,
} from "./primaryStaggerPhase";
import {
  COMPRESSED_SCHEDULE,
  STRETCHED_SCHEDULE,
  getPrimaryWaveSchedule,
} from "@/lib/constants/primaryCalendar";
import { presidentialRulesetFor } from "@/lib/elections/presidentialRuleset";
import type { Db } from "mongodb";
import type { Election } from "@/lib/db/types";

describe("stretched calendar — one wave per offset, zero in gaps (the core bug fix)", () => {
  const offsets = STRETCHED_SCHEDULE.waves.map((w) => w.turnsRemaining); // [40,32,24,16,8,0]

  it("stretched offsets are strictly decreasing and spaced by 8", () => {
    expect(offsets).toEqual([40, 32, 24, 16, 8, 0]);
  });

  it("due-wave count matches the number of offsets already reached, for every turn in the window", () => {
    for (let turnsToEnd = 0; turnsToEnd <= STRETCHED_SCHEDULE.windowTurns; turnsToEnd++) {
      const expected = offsets.filter((o) => o >= turnsToEnd).length;
      expect(getDuePrimaryWaveCount(turnsToEnd, STRETCHED_SCHEDULE)).toBe(expected);
    }
  });

  it("adds exactly ONE due wave at each scheduled offset and NONE in the gap turns", () => {
    // Walk the window from earliest (T-40) to close (T-0). The due count may go
    // up by exactly 1 only on a scheduled offset turn; every gap turn holds.
    let prev = getDuePrimaryWaveCount(41, STRETCHED_SCHEDULE);
    expect(prev).toBe(0); // T-41 is outside the window entirely
    for (let turnsToEnd = 40; turnsToEnd >= 0; turnsToEnd--) {
      const count = getDuePrimaryWaveCount(turnsToEnd, STRETCHED_SCHEDULE);
      const delta = count - prev;
      if (offsets.includes(turnsToEnd)) {
        expect(delta).toBe(1); // a wave fires exactly on its offset
      } else {
        expect(delta).toBe(0); // gap turn: nothing new fires
      }
      prev = count;
    }
    expect(prev).toBe(6); // all six waves due by close
  });

  it("outside the stretched window (T-41+) no wave is due", () => {
    expect(getDuePrimaryWaveCount(41, STRETCHED_SCHEDULE)).toBe(0);
    expect(getDuePrimaryWaveCount(100, STRETCHED_SCHEDULE)).toBe(0);
    expect(getDuePrimaryWaveCount(-1, STRETCHED_SCHEDULE)).toBe(0);
  });

  it("the compressed calendar still bunches all six into the final six turns", () => {
    // Contrast: at T-5 all offsets 5..0 are within reach in six consecutive turns.
    expect(getDuePrimaryWaveCount(5, COMPRESSED_SCHEDULE)).toBe(1);
    expect(getDuePrimaryWaveCount(0, COMPRESSED_SCHEDULE)).toBe(6);
    expect(getDuePrimaryWaveCount(6, COMPRESSED_SCHEDULE)).toBe(0);
  });
});

describe("momentumMultiplier — cap 0 is exact identity", () => {
  it("returns exactly 1 at cap 0 for any prior momentum (byte-identical vote path)", () => {
    for (const prior of [-10, -3, 0, 0.5, 3, 42]) {
      expect(momentumMultiplier(prior, 0)).toBe(1);
    }
  });

  it("returns exactly 1 when there is no carried momentum, at any cap", () => {
    for (const cap of [0, 2, 4, 6]) {
      expect(momentumMultiplier(0, cap)).toBe(1);
    }
  });

  it("scales up for positive carried momentum and down for negative, bounded by cap", () => {
    expect(momentumMultiplier(4, 6)).toBeCloseTo(1.04, 10);
    expect(momentumMultiplier(-4, 6)).toBeCloseTo(0.96, 10);
    // Prior beyond the cap is clamped to the cap first.
    expect(momentumMultiplier(50, 6)).toBeCloseTo(1.06, 10);
    expect(momentumMultiplier(-50, 6)).toBeCloseTo(0.94, 10);
  });
});

describe("waveMomentumPoints — expectation beat/miss, clamped", () => {
  it("is the signed share gap clamped to +-cap", () => {
    expect(waveMomentumPoints(30, 38, 6)).toBe(6); // +8 beat clamped to +6
    expect(waveMomentumPoints(30, 26, 6)).toBe(-4); // -4 miss within cap
    expect(waveMomentumPoints(30, 10, 6)).toBe(-6); // -20 miss clamped to -6
  });

  it("is 0 at cap 0 regardless of the gap (signed zero is still zero)", () => {
    expect(waveMomentumPoints(30, 90, 0)).toBeCloseTo(0, 10);
    expect(waveMomentumPoints(90, 30, 0)).toBeCloseTo(0, 10);
  });
});

describe("accumulateMomentum — decay then add, clamped", () => {
  it("halves the carried momentum at decay 0.5 then adds this wave's beat", () => {
    // prior 6, decay 0.5 -> 3, plus +2 = 5.
    expect(accumulateMomentum(6, 2, 0.5, 6)).toBe(5);
    // prior 4 -> 2, plus -1 = 1.
    expect(accumulateMomentum(4, -1, 0.5, 6)).toBe(1);
  });

  it("clamps the accumulated total to +-cap", () => {
    // prior 6 -> 3, plus +6 = 9, clamped to +6.
    expect(accumulateMomentum(6, 6, 0.5, 6)).toBe(6);
    // prior -6 -> -3, plus -6 = -9, clamped to -6.
    expect(accumulateMomentum(-6, -6, 0.5, 6)).toBe(-6);
  });

  it("decays a beat toward zero over several quiet waves", () => {
    let m = accumulateMomentum(0, 6, 0.5, 6); // 6
    m = accumulateMomentum(m, 0, 0.5, 6); // 3
    m = accumulateMomentum(m, 0, 0.5, 6); // 1.5
    m = accumulateMomentum(m, 0, 0.5, 6); // 0.75
    expect(m).toBeCloseTo(0.75, 10);
  });

  it("stays pinned at 0 for the whole cycle at cap 0 (nothing to persist but zeros)", () => {
    let m = 0;
    for (const beat of [8, -5, 10, -3, 0, 2]) {
      const c = waveMomentumPoints(30, 30 + beat, 0);
      m = accumulateMomentum(m, c, 0.5, 0);
      expect(m).toBe(0);
    }
  });
});

describe("v1 / down-ballot protection", () => {
  it("momentum is enabled ONLY on the stretched calendar (v3), never v1/v2/unstamped", () => {
    expect(momentumEnabledForRuleset(presidentialRulesetFor({ rulesetVersion: 1 }))).toBe(false);
    expect(momentumEnabledForRuleset(presidentialRulesetFor({ rulesetVersion: 2 }))).toBe(false);
    expect(momentumEnabledForRuleset(presidentialRulesetFor(undefined))).toBe(false);
    expect(momentumEnabledForRuleset(presidentialRulesetFor({ rulesetVersion: 3 }))).toBe(true);
  });

  it("a v1 race runs the compressed calendar (no stretched spacing, no momentum)", () => {
    const v1Schedule = getPrimaryWaveSchedule(presidentialRulesetFor({ rulesetVersion: 1 }));
    expect(v1Schedule).toBe(COMPRESSED_SCHEDULE);
    expect(v1Schedule.windowTurns).toBe(6);
  });

  it("a non-presidential election never enters the stagger path (down-ballot untouched)", async () => {
    // The president gate is the FIRST statement; a down-ballot race must return
    // null before touching the DB at all. A db proxy that throws on any access
    // proves nothing in the stagger engine runs for non-presidential races.
    const throwingDb = new Proxy(
      {},
      {
        get() {
          throw new Error("down-ballot primary must not touch the stagger DB path");
        },
      }
    ) as unknown as Db;

    for (const electionType of ["house", "senate", "governor", "commons"] as const) {
      const election = {
        _id: undefined,
        electionType,
        primaryEndTurn: 5,
      } as unknown as Election;
      const result = await runPrimaryStaggerWaveIfDue(throwingDb, election, new Date(), 3);
      expect(result).toBeNull();
    }
  });
});
