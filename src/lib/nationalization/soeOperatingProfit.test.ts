import { describe, it, expect } from "vitest";
import {
  soeIdleUpkeepCost,
  soeRealizedRevenue,
  soeSectorOperatingProfit,
  type SoeOperatingProfitInput,
} from "./soeOperatingProfit";
import { IDLE_UPKEEP_FRACTION, MOTHBALL_UPKEEP_FRACTION } from "@/lib/constants/capacityEconomy";

/**
 * Ticket 1072: mothballing a plant made a state-owned holding report MORE
 * operating profit than running it. The invariants below are the ones that
 * were violated on prod, stated so they cannot come back quietly.
 */

/** The prod row that reported the bug: East German Manufacturing, Saxony, turn 243. */
const RUNNING: SoeOperatingProfitInput = {
  revenue: 3719253,
  realizedRevenue: 3719253,
  profitMargin: 12,
  effectiveProfitMargin: 12,
  mothballed: false,
  capitalUtilization: 0.85,
  throughputFactor: 0.85,
  plantsUpkeepMarginBasisAnchor: 0.88,
};

describe("soeRealizedRevenue", () => {
  it("is zero for a mothballed plant even though the nameplate survives", () => {
    expect(soeRealizedRevenue({ ...RUNNING, mothballed: true }, true)).toBe(0);
  });

  it("never reads the nameplate when a realized figure is present", () => {
    expect(soeRealizedRevenue({ revenue: 1_000_000, realizedRevenue: 0 }, true)).toBe(0);
  });

  it("falls back to the nameplate for a sector that has not run a turn", () => {
    expect(soeRealizedRevenue({ revenue: 500 }, true)).toBe(500);
  });

  it("ignores the mothball flag below plants, where the button does not exist", () => {
    expect(soeRealizedRevenue({ revenue: 500, mothballed: true }, false)).toBe(500);
  });
});

describe("soeIdleUpkeepCost", () => {
  it("charges the mothball rate on the whole capacity", () => {
    const cold = { ...RUNNING, mothballed: true, capitalUtilization: 0 };
    expect(soeIdleUpkeepCost(cold, true)).toBeCloseTo(3719253 * 0.88 * MOTHBALL_UPKEEP_FRACTION, 6);
  });

  it("charges the idle rate only on the share the owner chose to leave idle", () => {
    const half = { ...RUNNING, capitalUtilization: 0.425 };
    expect(soeIdleUpkeepCost(half, true)).toBeCloseTo(
      3719253 * 0.5 * 0.88 * IDLE_UPKEEP_FRACTION,
      6
    );
  });

  it("charges nothing for capacity stopped by an input shortage", () => {
    const throughputBound = { ...RUNNING, capitalUtilization: 0.6, throughputFactor: 0.6 };
    expect(soeIdleUpkeepCost(throughputBound, true)).toBe(0);
  });

  it("is zero below plants", () => {
    expect(soeIdleUpkeepCost({ ...RUNNING, mothballed: true }, false)).toBe(0);
  });
});

describe("soeSectorOperatingProfit", () => {
  it("a mothballed sector never out-earns the same sector running", () => {
    const running = soeSectorOperatingProfit(RUNNING, true, 12);
    const mothballed = soeSectorOperatingProfit(
      { ...RUNNING, mothballed: true, realizedRevenue: 0, capitalUtilization: 0 },
      true,
      12
    );
    expect(running).toBeGreaterThan(0);
    expect(mothballed).toBeLessThan(running);
  });

  it("a mothballed sector books a LOSS, not a profit", () => {
    const mothballed = soeSectorOperatingProfit(
      { ...RUNNING, mothballed: true, realizedRevenue: 0, capitalUtilization: 0 },
      true,
      12
    );
    expect(mothballed).toBeLessThan(0);
  });

  it("does not pay out on the counterfactual margin a cold plant reports", () => {
    // The prod shape: the engine keeps reporting "what my margin would be if I
    // ran" for a sector with no revenue, and the nameplate never moved. The old
    // expression returned revenue x 44.88% = +491,062 for this row.
    const cold: SoeOperatingProfitInput = {
      revenue: 1094167,
      realizedRevenue: 0,
      profitMargin: 12,
      effectiveProfitMargin: 44.88,
      mothballed: false,
      capitalUtilization: 0,
      throughputFactor: 0.85,
      plantsUpkeepMarginBasisAnchor: 0.88,
    };
    expect(1094167 * (44.88 / 100)).toBeGreaterThan(400_000);
    expect(soeSectorOperatingProfit(cold, true, 12)).toBeLessThan(0);
  });

  it("reports a running loss as a loss instead of flooring it at zero", () => {
    const losing = { ...RUNNING, effectiveProfitMargin: -280.08 };
    expect(soeSectorOperatingProfit(losing, true, 12)).toBeLessThan(0);
  });

  it("prefers the booked P&L when the turn has written one", () => {
    const booked = { ...RUNNING, plantsPnl: { profit: -12345 } };
    expect(soeSectorOperatingProfit(booked, true, 12)).toBe(-12345);
  });

  it("ignores an incomplete booked P&L rather than reading NaN as money", () => {
    const broken = { ...RUNNING, plantsPnl: { profit: Number.NaN } };
    expect(soeSectorOperatingProfit(broken, true, 12)).toBeCloseTo(3719253 * 0.12, 6);
  });

  it("is the plain margin expression below plants", () => {
    expect(soeSectorOperatingProfit(RUNNING, false, 12)).toBeCloseTo(3719253 * 0.12, 6);
  });

  it("is monotone in operating capacity: less running is never more profit", () => {
    const full = soeSectorOperatingProfit(RUNNING, true, 12);
    const half = soeSectorOperatingProfit(
      { ...RUNNING, realizedRevenue: 3719253 / 2, capitalUtilization: 0.425 },
      true,
      12
    );
    const cold = soeSectorOperatingProfit(
      { ...RUNNING, mothballed: true, realizedRevenue: 0, capitalUtilization: 0 },
      true,
      12
    );
    expect(full).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(cold);
  });
});
