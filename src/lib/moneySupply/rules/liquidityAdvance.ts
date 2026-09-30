/** Liquidity advances retain the existing deposit-weighted, whole-unit allocation. */
export function allocateLiquidityAdvance(amount: number, deposits: readonly number[]): number[] {
  const weights = deposits.map((value) => Math.max(0, value));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight) =>
    total > 0 ? Math.floor((amount * weight) / total) : Math.floor(amount / weights.length)
  );
}
