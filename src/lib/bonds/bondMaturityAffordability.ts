export interface BondMaturityAffordabilityInput {
  currentLiquidCapital: number;
  repaymentAmount: number;
  turnsRemaining: number;
  retainedEarningsPerTurn: number | null | undefined;
}

export interface BondMaturityAffordability {
  /** Current liquid capital plus supported retained earnings through maturity. */
  cashAtMaturity: number;
  /** Amount by which the repayment exceeds cash at maturity, or zero if covered. */
  shortfall: number;
  isCovered: boolean;
  /** False when current cash is used because the retained earnings rate is unavailable or non-positive. */
  usedProjection: boolean;
}

/**
 * Estimate whether liquid capital will cover a bond repayment at maturity.
 *
 * Only positive, finite retained earnings are projected forward. Negative,
 * zero, or unknown earnings keep the existing current-cash comparison so this
 * display estimate never treats a loss as a cash forecast.
 */
export function projectBondMaturityAffordability({
  currentLiquidCapital,
  repaymentAmount,
  turnsRemaining,
  retainedEarningsPerTurn,
}: BondMaturityAffordabilityInput): BondMaturityAffordability {
  const positiveRetainedEarningsPerTurn =
    typeof retainedEarningsPerTurn === "number" &&
    Number.isFinite(retainedEarningsPerTurn) &&
    retainedEarningsPerTurn > 0
      ? retainedEarningsPerTurn
      : null;
  const projectedCash =
    positiveRetainedEarningsPerTurn !== null &&
    Number.isFinite(turnsRemaining) &&
    turnsRemaining >= 0
      ? currentLiquidCapital + positiveRetainedEarningsPerTurn * turnsRemaining
      : null;
  const safeProjection =
    projectedCash !== null && Number.isFinite(projectedCash) ? projectedCash : null;
  const usedProjection = safeProjection !== null;
  const cashAtMaturity = safeProjection ?? currentLiquidCapital;
  const shortfall = Math.max(0, repaymentAmount - cashAtMaturity);

  return {
    cashAtMaturity,
    shortfall,
    isCovered: shortfall === 0,
    usedProjection,
  };
}
