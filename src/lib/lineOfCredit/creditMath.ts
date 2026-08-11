import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";

/** Map composite 0–100 to spread in percentage points vs prime (+5 at 0, −1 at 100). */
export function spreadPercentPointsFromComposite(composite: number): number {
  const c = Math.max(0, Math.min(100, composite));
  return 5 - (c / 100) * 6;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Income quality 0–100 from one turn’s personal currency inflow (home currency face units):
 * salary/dividends, not campaign funds.
 * Annualizes with TURNS_PER_YEAR and uses a saturating exponential so large incomes cap near 100.
 */
export function incomeScoreFromPerTurnCurrency(perTurnNet: number): number {
  if (perTurnNet <= 0) return 0;
  const annual = perTurnNet * TURNS_PER_YEAR;
  return clamp(100 * (1 - Math.exp(-annual / 2_500_000)), 0, 100);
}

/** Net worth quality 0–100 from total wealth in internal units (sum of currency/rate). */
export function netWorthScoreFromInternal(netWorthInternal: number): number {
  if (netWorthInternal <= 0) return 0;
  return clamp(100 * (1 - Math.exp(-netWorthInternal / 4_000_000)), 0, 100);
}

/**
 * Blended user credit composite 0–100.
 * With CEO corp snapshot: 75% corp + 25% income.
 * Without: 50% income + 50% net worth.
 */
export function userCreditComposite(params: {
  corpComposite?: number | null;
  incomeScore: number;
  netWorthScore: number;
}): number {
  const { corpComposite, incomeScore, netWorthScore } = params;
  if (corpComposite != null && Number.isFinite(corpComposite) && corpComposite >= 0) {
    return clamp(0.75 * corpComposite + 0.25 * incomeScore, 0, 100);
  }
  return clamp(0.5 * incomeScore + 0.5 * netWorthScore, 0, 100);
}

/**
 * High LOC debt relative to total assets worsens the borrower composite (leverage penalty).
 */
export function applyDebtLeveragePenalty(composite: number, debtToAssetsRatio: number): number {
  if (!Number.isFinite(debtToAssetsRatio) || debtToAssetsRatio <= 0) return composite;
  const penalty = Math.min(30, debtToAssetsRatio * 38);
  return clamp(composite - penalty, 0, 100);
}

/**
 * Tighter central-bank policy (prime above baseline) reduces composite; wealthier borrowers are
 * partially shielded via netWorthScore (0–100).
 */
export function applyPrimeEnvironmentToComposite(
  composite: number,
  primePercent: number,
  netWorthScore: number,
  baselinePrime = 2.5
): number {
  const excess = Math.max(0, primePercent - baselinePrime);
  const rawStress = Math.min(22, excess * 5);
  const shield = netWorthScore / 100;
  const eased = rawStress * (1 - 0.65 * shield);
  return clamp(composite - eased, 0, 100);
}

/**
 * Single pipeline: base blend → leverage penalty → prime stress (wealth-modulated).
 */
export function computeLocBorrowerComposite(params: {
  corpComposite: number | null;
  incomeScore: number;
  netWorthScore: number;
  debtToAssetsRatio: number;
  homePrimePercent: number;
}): number {
  const base = userCreditComposite({
    corpComposite: params.corpComposite,
    incomeScore: params.incomeScore,
    netWorthScore: params.netWorthScore,
  });
  const afterLeverage = applyDebtLeveragePenalty(base, params.debtToAssetsRatio);
  return applyPrimeEnvironmentToComposite(
    afterLeverage,
    params.homePrimePercent,
    params.netWorthScore
  );
}
