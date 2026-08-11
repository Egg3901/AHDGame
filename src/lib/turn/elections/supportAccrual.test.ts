import { describe, expect, it } from "vitest";
import { buildRallyAccrualEntry, tickSupportAccrual } from "./supportAccrual";
import {
  RALLY_IMMEDIATE_SHARE,
  RALLY_SPREAD_TURNS,
  SUPPORT_RALLY_FULL_VALUE,
} from "@/lib/electionEngine/electionFormulaFactors";

describe("buildRallyAccrualEntry", () => {
  it("returns zero entry for non-positive R", () => {
    expect(buildRallyAccrualEntry(0).immediateBump).toBe(0);
    expect(buildRallyAccrualEntry(-5).immediateBump).toBe(0);
    expect(buildRallyAccrualEntry(NaN).immediateBump).toBe(0);
  });

  it("splits R into 60% immediate / 40% spread over RALLY_SPREAD_TURNS", () => {
    const R = SUPPORT_RALLY_FULL_VALUE; // 10 baseline
    const { immediateBump, entry } = buildRallyAccrualEntry(R);
    expect(immediateBump).toBeCloseTo(R * RALLY_IMMEDIATE_SHARE);
    expect(entry.amountPerTurn).toBeCloseTo((R * (1 - RALLY_IMMEDIATE_SHARE)) / RALLY_SPREAD_TURNS);
    expect(entry.turnsRemaining).toBe(RALLY_SPREAD_TURNS);
  });

  it("immediate + trailing accrual total to R within float tolerance", () => {
    const R = 10;
    const { immediateBump, entry } = buildRallyAccrualEntry(R);
    const trailingTotal = entry.amountPerTurn * entry.turnsRemaining;
    expect(immediateBump + trailingTotal).toBeCloseTo(R, 6);
  });

  it("scales linearly for per-race-family scalar (sub-presidential)", () => {
    // State Senate scalar 0.2 → R = 2
    const R = SUPPORT_RALLY_FULL_VALUE * 0.2;
    const { immediateBump, entry } = buildRallyAccrualEntry(R);
    expect(immediateBump).toBeCloseTo(1.2); // 60% of 2
    expect(entry.amountPerTurn).toBeCloseTo(0.2); // 40% of 2 / 4 turns
  });
});

describe("tickSupportAccrual", () => {
  it("returns zero delta and empty accrual for undefined input", () => {
    const out = tickSupportAccrual(undefined);
    expect(out.delta).toBe(0);
    expect(out.newAccrual).toEqual([]);
  });

  it("returns zero delta and empty accrual for empty input", () => {
    const out = tickSupportAccrual([]);
    expect(out.delta).toBe(0);
    expect(out.newAccrual).toEqual([]);
  });

  it("applies single entry's amountPerTurn as delta and decrements turnsRemaining", () => {
    const accrual = [{ amountPerTurn: 1.0, turnsRemaining: 4 }];
    const out = tickSupportAccrual(accrual);
    expect(out.delta).toBeCloseTo(1.0);
    expect(out.newAccrual).toEqual([{ amountPerTurn: 1.0, turnsRemaining: 3 }]);
  });

  it("prunes entries whose turnsRemaining hits 0 after decrement", () => {
    const accrual = [{ amountPerTurn: 1.0, turnsRemaining: 1 }];
    const out = tickSupportAccrual(accrual);
    expect(out.delta).toBeCloseTo(1.0);
    expect(out.newAccrual).toEqual([]); // pruned
  });

  it("sums deltas across multiple entries (rally tour at steady state)", () => {
    // Steady state of a tour: 4 active entries from previous 4 turns,
    // each with amountPerTurn = 0.4*10/4 = 1.0. Total drip = 4.0/turn.
    const accrual = [
      { amountPerTurn: 1.0, turnsRemaining: 4 },
      { amountPerTurn: 1.0, turnsRemaining: 3 },
      { amountPerTurn: 1.0, turnsRemaining: 2 },
      { amountPerTurn: 1.0, turnsRemaining: 1 },
    ];
    const out = tickSupportAccrual(accrual);
    expect(out.delta).toBeCloseTo(4.0);
    // Last entry should have been pruned (turnsRemaining was 1 → 0).
    expect(out.newAccrual).toHaveLength(3);
    expect(out.newAccrual.map((e) => e.turnsRemaining)).toEqual([3, 2, 1]);
  });

  it("skips defensively malformed entries (NaN amounts, zero turns)", () => {
    const accrual = [
      { amountPerTurn: NaN, turnsRemaining: 4 },
      { amountPerTurn: 1.0, turnsRemaining: 0 },
      { amountPerTurn: 1.0, turnsRemaining: 2 },
    ];
    const out = tickSupportAccrual(accrual);
    // Only the last entry counts.
    expect(out.delta).toBeCloseTo(1.0);
    expect(out.newAccrual).toEqual([{ amountPerTurn: 1.0, turnsRemaining: 1 }]);
  });
});
