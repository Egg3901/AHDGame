import { describe, expect, it } from "vitest";
import {
  RESERVE_POOL_TRANSFER_COOLDOWN_TURNS,
  RESERVE_POOL_TRANSFER_MAX_FRACTION,
  computeReservePoolTransferLimits,
  resolveReservePoolTransferAmount,
  turnsUntilReservePoolTransferReady,
} from "./reservePoolTransfer";

describe("computeReservePoolTransferLimits", () => {
  it("caps each direction at 50% of the source pool", () => {
    const limits = computeReservePoolTransferLimits({
      forexRevenue: 1000,
      lendingReserves: 800,
      totalDeposits: 10_000,
      totalLoansOutstanding: 0,
    });
    expect(limits.maxToLending).toBe(Math.floor(1000 * RESERVE_POOL_TRANSFER_MAX_FRACTION));
    expect(limits.maxToForex).toBe(Math.floor(800 * RESERVE_POOL_TRANSFER_MAX_FRACTION));
  });

  it("blocks lending→forex transfers that would leave outstanding loans uncovered", () => {
    // deposits 100, reserves 900 → pool = 700. Outstanding 700 means reserves
    // cannot fall below 900 (700/0.7 − 100 = 900).
    const limits = computeReservePoolTransferLimits({
      forexRevenue: 500,
      lendingReserves: 900,
      totalDeposits: 100,
      totalLoansOutstanding: 700,
    });
    expect(limits.minLendingReservesToCoverLoans).toBe(900);
    expect(limits.maxToForex).toBe(0);
    expect(limits.maxToLending).toBe(250);
  });

  it("allows a partial lending→forex move when spare capacity exists", () => {
    // deposits 1000, reserves 1000 → pool = 1400. Outstanding 700 needs
    // reserves ≥ 700/0.7 − 1000 = 0, so 50% of reserves (500) is movable.
    const limits = computeReservePoolTransferLimits({
      forexRevenue: 200,
      lendingReserves: 1000,
      totalDeposits: 1000,
      totalLoansOutstanding: 700,
    });
    expect(limits.maxToForex).toBe(500);
  });

  it("tightens the forex-bound when outstanding loans leave little spare", () => {
    // deposits 100, reserves 1000 → pool = 770. Outstanding 700 needs
    // reserves ≥ ceil(700/0.7 − 100) = 900, so only 100 can leave lending.
    const limits = computeReservePoolTransferLimits({
      forexRevenue: 50,
      lendingReserves: 1000,
      totalDeposits: 100,
      totalLoansOutstanding: 700,
    });
    expect(limits.minLendingReservesToCoverLoans).toBe(900);
    expect(limits.maxToForex).toBe(100);
  });
});

describe("resolveReservePoolTransferAmount", () => {
  it("floors and clamps the requested amount to the direction cap", () => {
    const result = resolveReservePoolTransferAmount({
      direction: "toLending",
      amount: 999.9,
      forexRevenue: 1000,
      lendingReserves: 0,
      totalDeposits: 0,
      totalLoansOutstanding: 0,
    });
    expect(result.amount).toBe(500);
  });

  it("returns 0 for non-positive amounts", () => {
    const result = resolveReservePoolTransferAmount({
      direction: "toForex",
      amount: 0,
      forexRevenue: 0,
      lendingReserves: 1000,
      totalDeposits: 0,
      totalLoansOutstanding: 0,
    });
    expect(result.amount).toBe(0);
  });
});

describe("turnsUntilReservePoolTransferReady", () => {
  it("uses a 24-turn (once per day) cooldown", () => {
    expect(RESERVE_POOL_TRANSFER_COOLDOWN_TURNS).toBe(24);
    expect(
      turnsUntilReservePoolTransferReady({
        currentTurn: 110,
        lastTransferTurn: 100,
      })
    ).toBe(14);
    expect(
      turnsUntilReservePoolTransferReady({
        currentTurn: 124,
        lastTransferTurn: 100,
      })
    ).toBe(0);
  });

  it("lets admins bypass the cooldown", () => {
    expect(
      turnsUntilReservePoolTransferReady({
        currentTurn: 101,
        lastTransferTurn: 100,
        isAdmin: true,
      })
    ).toBe(0);
  });
});
