import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/**
 * v3 observation boundary (issue #2021): bond-market-pool settlement
 * inventory sits OUTSIDE observed M2, except QE-created money still parked
 * at the dealer.
 *
 * The pool is a dealer, not an end holder. Its cash mixes conserved legs
 * (secondary purchases/sales, corporate underwriting/coupons/maturities —
 * both sides inside M2, so they net to zero) with legs that have no M2
 * counterparty at all: sovereign maturities/coupons credit the pool without
 * debiting the treasury, sovereign underwriting debits it without crediting
 * one, `inflowIn` mints toward the target, and `sweepOut` burns back down.
 * Counting the raw pool balance therefore turns every 48-turn sovereign
 * maturity wave into explosive money creation followed by near-total
 * destruction (HU 6.36M% then -99.9% at raw turn 96), while the real
 * economy — corporate liquid 61.3M to 62.0M — moves smoothly underneath.
 *
 * Netting rule: observed M2 keeps `min(poolCash, max(0, qeIn - qtOut))` —
 * the QE-parked portion, which IS created base money awaiting transmission —
 * and reports the rest as `excludedBondPoolCash`. Under this rule every
 * pool-only leg (maturity/coupon mint, issuance burn, inflow, sweep) leaves
 * observed M2 exactly unchanged, and QE/QT still move it once. Conserved
 * legs move observed M2 at the holder side instead of netting inside it: a
 * bond purchase lowers observed M2 at once (deposits became a security) and
 * the matching sale raises it back; corporate issuance arrival raises it as
 * the proceeds land in liquid cash. The full cycle still nets to zero, but
 * the timing differs from v2, where the dealer leg kept both sides inside
 * M2. Version 3 marks the boundary so the one-time level drop can never
 * annualize as tightening.
 */
export const MONEY_ACCOUNTING_VERSION = 3;

export interface MoneySupplyComponents {
  /** Population-income estimates, excluded from M1 and M2. */
  estimatedHouseholdLiquid?: number;
  estimatedHouseholdSavings?: number;
  householdLiquid: number;
  campaignLiquid: number;
  nppLiquid: number;
  corporateLiquid: number;
  partyLiquid: number;
  governmentLiquid: number;
  fundLiquid: number;
  organizationLiquid: number;
  householdSavings: number;
  /** Deposits belonging to the simulated population/businesses outside player documents. */
  externalBroadMoney: number;
  /**
   * Deposits sitting on chartered private-bank books.
   *
   * Capturing an NPC deposit debits `externalBroadMoney` and credits the bank's
   * book. Counting only the first leg made measured M2 shrink as private banking
   * grew, which reads as monetary tightening that never happened and can trip
   * the NPP policy engine into a QT it should not want.
   */
  bankDeposits: number;
  /** A bank asset/capacity measure. Reported separately; never double-counted in M1/M2. */
  bankReserves: number;
  creditOutstanding: number;
  sovereignBondsOutstanding: number;
  centralBankBondHoldings: number;
  /**
   * Cash held by the currency's bond market pool: the banks, insurers and
   * funds that stand behind `Bond.publicFloat`. A raw audit component only:
   * settlement inventory in transit, NOT observed money (see the v3 boundary
   * above). Never M1.
   */
  bondPoolCash: number;
  /**
   * Lifetime QE considerations credited to the currency's bond pool. Paired
   * with `bondPoolQeOut` to net the QE-parked portion back into observed M2.
   * Absent on legacy pools without flow counters: treated as zero, so their
   * whole balance reads as settlement inventory.
   */
  bondPoolQeIn?: number;
  /** Lifetime QT considerations debited from the currency's bond pool. */
  bondPoolQeOut?: number;
  /** Cash held by the finite public-equity market pool. Institutional M2, not M1. */
  equityPoolCash?: number;
}

export interface MoneyAggregates extends MoneySupplyComponents {
  m1: number;
  /** Observed M2 under the v3 boundary: pool settlement inventory excluded. */
  m2: number;
  /**
   * Bond-pool cash counted inside observed M2: only QE-created money still
   * parked at the dealer, `min(poolCash, max(0, qeIn - qtOut))`.
   */
  observedBondPoolCash?: number;
  /** Bond-pool cash outside observed M2: `bondPoolCash - observedBondPoolCash`. */
  excludedBondPoolCash?: number;
}

function money(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function calculateMoneyAggregates(input: MoneySupplyComponents): MoneyAggregates {
  const normalized = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, money(value)])
  ) as unknown as MoneySupplyComponents;
  const m1 =
    normalized.householdLiquid +
    normalized.campaignLiquid +
    normalized.nppLiquid +
    normalized.corporateLiquid +
    normalized.partyLiquid +
    normalized.governmentLiquid +
    normalized.fundLiquid +
    normalized.organizationLiquid;
  const poolCash = money(normalized.bondPoolCash ?? 0);
  const qeFunded = Math.max(
    0,
    money(normalized.bondPoolQeIn ?? 0) - money(normalized.bondPoolQeOut ?? 0)
  );
  const observedBondPoolCash = Math.min(poolCash, qeFunded);
  const excludedBondPoolCash = poolCash - observedBondPoolCash;
  return {
    ...normalized,
    m1,
    m2:
      m1 +
      normalized.householdSavings +
      normalized.externalBroadMoney +
      normalized.bankDeposits +
      observedBondPoolCash +
      (normalized.equityPoolCash ?? 0),
    observedBondPoolCash,
    excludedBondPoolCash,
  };
}

/**
 * Minimum observation window before annualized M2 growth is defined.
 *
 * Snapshot lookback targets `turn - 12` (a game-quarter). Annualizing a stock
 * jump over a shorter window ; e.g. a 2.4× bootstrap rebase over 2 turns ;
 * raises the ratio to the 24th power and produces 10^8-10^16 "% growth" that
 * is a first-observation artefact, not monetary expansion. Only observations with the same accounting version may form this window.
 */
export const MIN_MONEY_GROWTH_BASE_TURNS = 12;

/**
 * Annualized M2 growth in percent, or `null` when the rate is not defined.
 *
 * Returns null (not 0) for a missing/short base so consumers that already
 * treat non-finite values as "fall back to gdpGrowth" ; notably
 * inflationRecalc's `finiteOr` ; get a zero monetary impulse rather than a
 * false "money supply is frozen" reading. A cosmetic clamp on the output is
 * deliberately not applied: if the components are wrong, fix the components.
 */
export function annualizedMoneyGrowthPct(
  opening: number,
  closing: number,
  turnsElapsed: number
): number | null {
  if (opening <= 0 || closing <= 0 || turnsElapsed < MIN_MONEY_GROWTH_BASE_TURNS) return null;
  const growth = (closing / opening) ** (TURNS_PER_YEAR / turnsElapsed) - 1;
  if (!Number.isFinite(growth)) return null;
  return growth * 100;
}
