import { describe, expect, it } from "vitest";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import {
  annualizedMoneyGrowthPct,
  calculateMoneyAggregates,
  MONEY_ACCOUNTING_VERSION,
  type MoneySupplyComponents,
} from "./calculate";
import { currentMoneyGrowth } from "./growthSignal";

/**
 * Deterministic accounting tests for the v3 observed-M2 boundary (issue
 * #2021): bond-pool settlement inventory sits outside observed M2, except
 * QE-created money still parked at the dealer.
 *
 * The pool is a dealer, not an end holder. Its cash mixes conserved legs
 * (secondary purchases/sales, corporate underwriting/coupons/maturities) with
 * legs that have no M2 counterparty at all: sovereign maturities/coupons
 * credit the pool without debiting the treasury, sovereign underwriting
 * debits it without crediting one, `inflowIn` mints toward the target, and
 * `sweepOut` burns back down. Counting the raw balance turned each 48-turn
 * sovereign maturity wave into fake creation then destruction.
 */

function base(overrides: Partial<MoneySupplyComponents> = {}): MoneySupplyComponents {
  return {
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
    bondPoolCash: 0,
    ...overrides,
  };
}

/** The six planned-economy currencies from the raw-48/96/144 reproduction. */
const PLANNED: Array<{ country: "HU" | "PL" | "RO" | "YU" | "BG" | "CS"; code: CurrencyCode }> = [
  { country: "HU", code: "HUF" },
  { country: "PL", code: "PLZ" },
  { country: "RO", code: "ROL" },
  { country: "YU", code: "YUD" },
  { country: "BG", code: "BGL" },
  { country: "CS", code: "CSK" },
];

/** Market currencies with active QE/QT and equity-market transmission. */
const MARKET: CurrencyCode[] = ["USD", "GBP", "JPY"];

describe("bond-pool settlement boundary in observed M2", () => {
  it("marks the v3 observation contract", () => {
    expect(MONEY_ACCOUNTING_VERSION).toBe(3);
  });

  it("leaves observed M2 unchanged through the HU raw-96 pulse shape", () => {
    // Real economy moves smoothly (corporate liquid 61.3M to 62.0M) while the
    // pool jumps 1.338B to 6.061B and drains to 437.8M with no QE legs.
    const real = base({ corporateLiquid: 61_300_000, externalBroadMoney: 1_000_000 });
    const flat = calculateMoneyAggregates(real).m2;
    for (const poolCash of [1_338_000_000, 6_061_000_000, 437_800_000]) {
      const row = calculateMoneyAggregates({ ...real, bondPoolCash: poolCash });
      expect(row.m2).toBe(flat);
      expect(row.observedBondPoolCash).toBe(0);
      expect(row.excludedBondPoolCash).toBe(poolCash);
    }
  });

  it("holds observed M2 flat across every pool-only leg level", () => {
    // Maturity/coupon mint, issuance burn, inflow mint and sweep burn all move
    // poolCash with no QE funding behind them: pure settlement inventory.
    const before = calculateMoneyAggregates(base({ governmentLiquid: 5_000 })).m2;
    for (const poolCash of [0, 250_000_000, 4_700_000_000, 12_000_000, 0]) {
      expect(
        calculateMoneyAggregates(base({ governmentLiquid: 5_000, bondPoolCash: poolCash })).m2
      ).toBe(before);
    }
  });

  it("still represents genuine household, corporate, government, deposit and external money", () => {
    const setup = { corporateLiquid: 61_300_000 };
    const before = calculateMoneyAggregates(base(setup)).m2;
    const moves: Array<{ with: Partial<MoneySupplyComponents>; delta: number }> = [
      { with: { householdLiquid: 1_000 }, delta: 1_000 },
      { with: { corporateLiquid: 62_000_000 }, delta: 700_000 },
      { with: { governmentLiquid: 2_000 }, delta: 2_000 },
      { with: { householdSavings: 3_000 }, delta: 3_000 },
      { with: { bankDeposits: 400 }, delta: 400 },
      { with: { externalBroadMoney: 5_000 }, delta: 5_000 },
      { with: { equityPoolCash: 900 }, delta: 900 },
    ];
    for (const move of moves) {
      const after = calculateMoneyAggregates(base({ ...setup, ...move.with }));
      expect(after.m2 - before).toBe(move.delta);
    }
  });

  it("keeps reserves, credit and bond stocks out of observed M2", () => {
    const before = calculateMoneyAggregates(base()).m2;
    const row = calculateMoneyAggregates(
      base({
        bankReserves: 10_000,
        creditOutstanding: 20_000,
        sovereignBondsOutstanding: 30_000,
        centralBankBondHoldings: 40_000,
      })
    );
    expect(row.m2).toBe(before);
  });

  it("counts QE into observed M2 exactly once", () => {
    const before = calculateMoneyAggregates(base({ corporateLiquid: 1_000 })).m2;
    // QE parks consideration A at the dealer: pool cash and QE funding rise
    // together, and observed M2 rises by exactly A, not 2A.
    const amount = 1_000_000;
    const after = calculateMoneyAggregates(
      base({ corporateLiquid: 1_000, bondPoolCash: amount, bondPoolQeIn: amount })
    );
    expect(after.m2 - before).toBe(amount);
    expect(after.observedBondPoolCash).toBe(amount);
    expect(after.excludedBondPoolCash).toBe(0);
  });

  it("caps observed pool cash at the cash actually present", () => {
    // QE funding without matching pool cash cannot conjure money: observed is
    // min(poolCash, funded), so a transmitted remainder counts at its new home.
    const row = calculateMoneyAggregates(base({ bondPoolCash: 200, bondPoolQeIn: 1_000 }));
    expect(row.observedBondPoolCash).toBe(200);
    expect(row.excludedBondPoolCash).toBe(0);
  });

  it("retires QT from QE-parked cash exactly once, then floors at zero", () => {
    const parked = { corporateLiquid: 1_000, bondPoolCash: 1_000, bondPoolQeIn: 1_000 };
    const full = calculateMoneyAggregates(base(parked)).m2;
    const partial = calculateMoneyAggregates(
      base({ ...parked, bondPoolCash: 600, bondPoolQeOut: 400 })
    );
    expect(partial.m2 - full).toBe(-400);
    expect(partial.observedBondPoolCash).toBe(600);
    const drained = calculateMoneyAggregates(
      base({ ...parked, bondPoolCash: 0, bondPoolQeOut: 1_000 })
    );
    expect(drained.observedBondPoolCash).toBe(0);
    // Over-retiring past the funded amount cannot push observed M2 negative.
    const over = calculateMoneyAggregates(
      base({ ...parked, bondPoolCash: 0, bondPoolQeOut: 1_500 })
    );
    expect(over.observedBondPoolCash).toBe(0);
    expect(over.m2).toBe(drained.m2);
  });

  it("lets QT drain pure settlement inventory without touching observed M2", () => {
    const before = calculateMoneyAggregates(
      base({ corporateLiquid: 62_000_000, bondPoolCash: 6_061_000_000 })
    );
    const after = calculateMoneyAggregates(
      base({ corporateLiquid: 62_000_000, bondPoolCash: 437_800_000 })
    );
    expect(after.m2).toBe(before.m2);
    expect(before.excludedBondPoolCash! - after.excludedBondPoolCash!).toBe(
      6_061_000_000 - 437_800_000
    );
  });

  it("lowers observed M2 at once on a secondary purchase", () => {
    // A bond purchase moves deposits into a security: corporate cash falls 100
    // while pool cash rises 100 with no QE funding, so observed M2 falls 100.
    // Under v2 both sides sat inside M2 and the purchase netted to zero; v3
    // moves observed M2 at the holder side and the matching sale reverses it.
    const before = calculateMoneyAggregates(base({ corporateLiquid: 10_000 })).m2;
    const after = calculateMoneyAggregates(base({ corporateLiquid: 9_900, bondPoolCash: 100 })).m2;
    expect(after - before).toBe(-100);
  });

  it("holds the 48-turn cadence flat at 48, 96 and 144", () => {
    // The reproduction repeats at raw turns 48, 96 and 144. Under the v3
    // boundary every wave leaves observed M2 on its organic path instead of
    // alternating million-percent creation with near-total destruction.
    const opening = calculateMoneyAggregates(base({ corporateLiquid: 61_300_000 })).m2;
    for (const poolCash of [4_700_000_000, 6_100_000_000, 800_000_000]) {
      const pulsed = calculateMoneyAggregates(
        base({ corporateLiquid: 62_000_000, bondPoolCash: poolCash })
      );
      const flat = calculateMoneyAggregates(base({ corporateLiquid: 62_000_000 }));
      expect(pulsed.m2).toBe(flat.m2);
      expect(pulsed.excludedBondPoolCash).toBe(poolCash);
      // Only the genuine 61.3M to 62.0M corporate move annualizes, never the wave.
      const growth = annualizedMoneyGrowthPct(opening, pulsed.m2, 48);
      expect(growth).not.toBeNull();
      expect(Math.abs(growth!)).toBeLessThan(50);
    }
    // Contrast: counting the raw pool balance the old way annualizes the HU
    // 1.400B to 6.124B wave into an absurd print over the same window.
    const oldWay = annualizedMoneyGrowthPct(1_400_000_000, 6_124_000_000, 12);
    expect(oldWay).not.toBeNull();
    expect(Math.abs(oldWay!)).toBeGreaterThan(10_000);
    // And the drain side reads as near-total destruction the old way.
    const oldDrain = annualizedMoneyGrowthPct(6_124_000_000, 501_800_000, 12);
    expect(oldDrain).not.toBeNull();
    expect(oldDrain!).toBeLessThan(-99);
  });

  it("covers all six planned currencies with the same boundary", () => {
    const seen = new Map<CurrencyCode, { m2: number; excludedBondPoolCash: number }>();
    for (const { country, code } of PLANNED) {
      expect(COUNTRY_CURRENCY_MAP[country]).toBe(code);
      const flat = calculateMoneyAggregates(base({ corporateLiquid: 61_300_000 })).m2;
      const pulsed = calculateMoneyAggregates(
        base({ corporateLiquid: 62_000_000, bondPoolCash: 4_700_000_000 })
      );
      expect(pulsed.m2).toBe(flat + 700_000);
      seen.set(code, { m2: pulsed.m2, excludedBondPoolCash: pulsed.excludedBondPoolCash ?? 0 });
    }
    // Six distinct currencies, one shared boundary, identical readings.
    expect(seen.size).toBe(PLANNED.length);
    for (const row of seen.values()) {
      expect(row.m2).toBe(62_000_000);
      expect(row.excludedBondPoolCash).toBe(4_700_000_000);
    }
  });

  it("keeps QE-parked and equity cash inside M2 for market currencies", () => {
    const seen = new Set<CurrencyCode>();
    for (const code of MARKET) {
      seen.add(code);
      const plain = calculateMoneyAggregates(base({ externalBroadMoney: 1_000 })).m2;
      const parked = calculateMoneyAggregates(
        base({ externalBroadMoney: 1_000, bondPoolCash: 1_000, bondPoolQeIn: 1_000 })
      );
      expect(parked.m2 - plain).toBe(1_000);
      expect(parked.observedBondPoolCash).toBe(1_000);
      const withEquity = calculateMoneyAggregates(
        base({ externalBroadMoney: 1_000, equityPoolCash: 500 })
      );
      expect(withEquity.m2 - plain).toBe(500);
    }
    expect(seen.size).toBe(MARKET.length);
  });

  it("gates growth on the current contract across the v2 to v3 transition", () => {
    expect(
      currentMoneyGrowth({ accountingVersion: 2, annualizedM2GrowthPct: 6_360_000 })
    ).toBeNull();
    expect(currentMoneyGrowth({ accountingVersion: 1, annualizedM2GrowthPct: 4 })).toBeNull();
    expect(currentMoneyGrowth({ annualizedM2GrowthPct: 4 })).toBeNull();
    expect(currentMoneyGrowth(null)).toBeNull();
    expect(
      currentMoneyGrowth({
        accountingVersion: MONEY_ACCOUNTING_VERSION,
        annualizedM2GrowthPct: null,
      })
    ).toBeNull();
    expect(
      currentMoneyGrowth({ accountingVersion: MONEY_ACCOUNTING_VERSION, annualizedM2GrowthPct: 0 })
    ).toBe(0);
    expect(
      currentMoneyGrowth({
        accountingVersion: MONEY_ACCOUNTING_VERSION,
        annualizedM2GrowthPct: 4.25,
      })
    ).toBe(4.25);
  });

  it("reports no growth without a comparable base", () => {
    expect(annualizedMoneyGrowthPct(0, 1_000, 12)).toBeNull();
    expect(annualizedMoneyGrowthPct(1_000, 1_000, 11)).toBeNull();
    expect(annualizedMoneyGrowthPct(1_000, 1_000, 12)).toBe(0);
  });

  it("keeps legacy snapshots readable without letting them annualize", () => {
    // A v2 row keeps its level for audit display, but its growth never feeds
    // current decisions; an unversioned row behaves the same.
    const legacy = { accountingVersion: 2, annualizedM2GrowthPct: 500, m2: 6_124_000_000 };
    expect(legacy.m2).toBe(6_124_000_000);
    expect(currentMoneyGrowth(legacy)).toBeNull();
    expect(currentMoneyGrowth({ annualizedM2GrowthPct: 500 })).toBeNull();
  });

  it("reads legacy components without QE legs as pure settlement inventory", () => {
    const row = calculateMoneyAggregates(base({ corporateLiquid: 1_000, bondPoolCash: 700 }));
    expect(row.observedBondPoolCash).toBe(0);
    expect(row.excludedBondPoolCash).toBe(700);
    expect(row.m2).toBe(1_000);
  });

  it("clamps non-positive pool inputs instead of inventing money", () => {
    const row = calculateMoneyAggregates(
      base({ corporateLiquid: 1_000, bondPoolCash: -50, bondPoolQeIn: -10, bondPoolQeOut: -5 })
    );
    expect(row.observedBondPoolCash).toBe(0);
    expect(row.excludedBondPoolCash).toBe(0);
    expect(row.m2).toBe(1_000);
  });
});
