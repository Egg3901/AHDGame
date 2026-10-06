/**
 * Upcoming bond repayments compete for available cash and estimated operating income.
 * assessMaturityLiquidity forecasts cumulative principal plus fixed coupon run rate
 * within the supplied turn horizon; optional future borrowing adds no forecast cash.
 */

export interface MaturityLiquidityObligation {
  principalAnchor: number;
  maturityTurn: number;
  matured?: boolean;
  defaulted?: boolean;
}

export interface MaturityLiquidityBucket {
  maturityTurn: number;
  turnsRemaining: number;
  cumulativePrincipalAnchor: number;
  couponReserveAnchor: number;
  forecastCashAnchor: number;
  coverageRatio: number;
}

export function assessMaturityLiquidity(input: {
  obligations: readonly MaturityLiquidityObligation[];
  liquidCapitalAnchor: number;
  incomePerTurn: number;
  annualCouponObligations: number;
  currentTurn: number;
  horizonTurns: number;
  turnsPerYear: number;
}): {
  principalDueAnchor: number;
  liquidityScore: number | null;
  buckets: MaturityLiquidityBucket[];
} {
  if (
    !Number.isSafeInteger(input.currentTurn) ||
    !Number.isSafeInteger(input.horizonTurns) ||
    input.horizonTurns < 1 ||
    !(input.turnsPerYear > 0) ||
    !Number.isFinite(input.turnsPerYear) ||
    !Number.isFinite(input.liquidCapitalAnchor) ||
    !Number.isFinite(input.incomePerTurn) ||
    !Number.isFinite(input.annualCouponObligations)
  ) {
    throw new Error("Invalid maturity liquidity inputs");
  }
  const byTurn = new Map<number, number>();
  for (const bond of input.obligations) {
    if (bond.matured || bond.defaulted) continue;
    if (
      !Number.isSafeInteger(bond.maturityTurn) ||
      !Number.isFinite(bond.principalAnchor) ||
      bond.principalAnchor < 0
    ) {
      throw new Error("Invalid maturity obligation");
    }
    if (bond.principalAnchor === 0 || bond.maturityTurn > input.currentTurn + input.horizonTurns)
      continue;
    // Overdue amounts compete for cash now, rather than receiving past income again.
    const dueTurn = Math.max(input.currentTurn, bond.maturityTurn);
    byTurn.set(dueTurn, (byTurn.get(dueTurn) ?? 0) + bond.principalAnchor);
  }
  let cumulativePrincipalAnchor = 0;
  const buckets = [...byTurn.entries()]
    .sort(([a], [b]) => a - b)
    .map(([maturityTurn, principal]) => {
      cumulativePrincipalAnchor += principal;
      const turnsRemaining = maturityTurn - input.currentTurn;
      // Reserve the current coupon even when principal settles later this same turn.
      const couponReserveAnchor =
        (Math.max(0, input.annualCouponObligations) * Math.max(1, turnsRemaining)) /
        input.turnsPerYear;
      const forecastCashAnchor = Math.max(
        0,
        input.liquidCapitalAnchor + input.incomePerTurn * turnsRemaining
      );
      return {
        maturityTurn,
        turnsRemaining,
        cumulativePrincipalAnchor,
        couponReserveAnchor,
        forecastCashAnchor,
        coverageRatio: forecastCashAnchor / (cumulativePrincipalAnchor + couponReserveAnchor),
      };
    });
  return {
    principalDueAnchor: cumulativePrincipalAnchor,
    liquidityScore:
      buckets.length === 0
        ? null
        : 100 * Math.min(1, ...buckets.map((bucket) => bucket.coverageRatio)),
    buckets,
  };
}
