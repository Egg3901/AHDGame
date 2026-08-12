import { describe, expect, it } from "vitest";
import {
  calculateMoneyAggregates,
  annualizedMoneyGrowthPct,
  MIN_MONEY_GROWTH_BASE_TURNS,
} from "./calculate";

describe("money supply aggregates", () => {
  it("counts the whole modeled economy while keeping savings out of M1", () => {
    const result = calculateMoneyAggregates({
      householdLiquid: 100,
      campaignLiquid: 20,
      nppLiquid: 30,
      corporateLiquid: 200,
      partyLiquid: 10,
      governmentLiquid: 50,
      fundLiquid: 15,
      bankDeposits: 0,
      organizationLiquid: 5,
      householdSavings: 70,
      externalBroadMoney: 500,
      bankReserves: 40,
      creditOutstanding: 125,
      sovereignBondsOutstanding: 600,
      centralBankBondHoldings: 100,
    });

    expect(result.m1).toBe(430);
    expect(result.m2).toBe(1_000);
    expect(result.bankReserves).toBe(40);
    expect(result.creditOutstanding).toBe(125);
    expect(result.sovereignBondsOutstanding).toBe(600);
    expect(result.centralBankBondHoldings).toBe(100);
  });

  it("annualizes growth across the game's 48-turn year", () => {
    expect(annualizedMoneyGrowthPct(1_000, 1_010, 12)).toBeCloseTo(4.0604, 3);
    expect(annualizedMoneyGrowthPct(0, 1_010, 12)).toBeNull();
  });

  it("refuses to annualize over a short base (CNY/NGN 10^8–10^16 % artefact)", () => {
    // Reproduced from ahd_sim_preflightfx turn 0 → 2/3 snapshots: household
    // median-income warmup rebases M2 by 2.4× (CNY) / 7.8× (NGN) in 2–3 turns.
    // Naively annualizing those ratios at 48 turns/year yields 10^8–10^16 %.
    expect(annualizedMoneyGrowthPct(58_855_462_500, 139_818_805_610.9, 2)).toBeNull();
    expect(annualizedMoneyGrowthPct(58_855_462_500, 140_013_596_305.15, 3)).toBeNull();
    expect(annualizedMoneyGrowthPct(1_267_421_875, 8_602_151_252.85, 2)).toBeNull();
    expect(annualizedMoneyGrowthPct(1_267_421_875, 9_935_896_263.88, 3)).toBeNull();
    expect(MIN_MONEY_GROWTH_BASE_TURNS).toBe(12);
  });

  it("keeps a full-quarter move under a defensible absurdity ceiling", () => {
    // A real economy does not grow broad money by 10^6 %/yr. Even a hot 25%
    // quarterly rise annualizes well under that ceiling once the base is valid.
    const hot = annualizedMoneyGrowthPct(100, 125, 12);
    expect(hot).not.toBeNull();
    expect(Math.abs(hot!)).toBeLessThan(1_000_000);
    // Sane mid-century drifts (BRL-like ~2% from the preflight sandbox).
    const calm = annualizedMoneyGrowthPct(46_758_687_500, 46_816_364_643, 12);
    expect(calm).not.toBeNull();
    expect(Math.abs(calm!)).toBeLessThan(50);
  });
});

describe("bank deposits in M2", () => {
  const base = {
    householdLiquid: 0,
    campaignLiquid: 0,
    nppLiquid: 0,
    corporateLiquid: 0,
    partyLiquid: 0,
    governmentLiquid: 0,
    fundLiquid: 0,
    organizationLiquid: 0,
    householdSavings: 0,
    externalBroadMoney: 0,
    bankDeposits: 0,
    bankReserves: 0,
    creditOutstanding: 0,
    sovereignBondsOutstanding: 0,
    centralBankBondHoldings: 0,
  };

  it("keeps M2 flat when a deposit moves from the external pool onto a bank book", () => {
    const before = calculateMoneyAggregates({ ...base, externalBroadMoney: 1_000 });
    // Capturing the deposit debits externalBroadMoney and credits the bank.
    const after = calculateMoneyAggregates({
      ...base,
      externalBroadMoney: 600,
      bankDeposits: 400,
    });
    expect(after.m2).toBe(before.m2);
  });

  it("leaves M1 untouched by bank deposits", () => {
    const withDeposits = calculateMoneyAggregates({ ...base, bankDeposits: 400 });
    expect(withDeposits.m1).toBe(0);
    expect(withDeposits.m2).toBe(400);
  });
});
