import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

export interface MoneySupplyComponents {
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
   * funds that stand behind `Bond.publicFloat`. Institutional money, so it
   * counts toward M2 but not M1.
   */
  bondPoolCash: number;
}

export interface MoneyAggregates extends MoneySupplyComponents {
  m1: number;
  m2: number;
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
  return {
    ...normalized,
    m1,
    m2:
      m1 +
      normalized.householdSavings +
      normalized.externalBroadMoney +
      normalized.bankDeposits +
      normalized.bondPoolCash,
  };
}

/**
 * Minimum observation window before annualized M2 growth is defined.
 *
 * Snapshot lookback targets `turn - 12` (a game-quarter). Annualizing a stock
 * jump over a shorter window — e.g. a 2.4× bootstrap rebase over 2 turns —
 * raises the ratio to the 24th power and produces 10^8–10^16 "% growth" that
 * is a first-observation artefact, not monetary expansion. Matches the
 * `moneyGrowthReliable: turn >= 12` gate in nppPolicy.
 */
export const MIN_MONEY_GROWTH_BASE_TURNS = 12;

/**
 * Annualized M2 growth in percent, or `null` when the rate is not defined.
 *
 * Returns null (not 0) for a missing/short base so consumers that already
 * treat non-finite values as "fall back to gdpGrowth" — notably
 * inflationRecalc's `finiteOr` — get a zero monetary impulse rather than a
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
