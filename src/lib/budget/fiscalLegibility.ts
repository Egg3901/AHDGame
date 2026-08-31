/**
 * Player-facing fiscal figures derived from the national accounts.
 *
 * The fiscal dashboard shows both the raw accounting denominator and the
 * EMA-smoothed denominator used for sovereign solvency. Keeping this small
 * derivation separate makes the distinction explicit without changing either
 * budget calculation.
 */
export function deriveFiscalLegibility(input: {
  debtPrincipal: number;
  rawGdp: number;
  smoothedGdp?: number | null;
  revenue: number;
  spending: number;
  debtInterest: number;
}) {
  const rawDebtToGdp = input.rawGdp > 0 ? input.debtPrincipal / input.rawGdp : 0;
  const solvencyGdp =
    typeof input.smoothedGdp === "number" && input.smoothedGdp > 0
      ? input.smoothedGdp
      : input.rawGdp;
  const solvencyDebtToGdp = solvencyGdp > 0 ? input.debtPrincipal / solvencyGdp : 0;
  const primaryBalance = input.revenue - (input.spending - input.debtInterest);
  const overallBalance = input.revenue - input.spending;

  return { rawDebtToGdp, solvencyDebtToGdp, primaryBalance, overallBalance };
}
