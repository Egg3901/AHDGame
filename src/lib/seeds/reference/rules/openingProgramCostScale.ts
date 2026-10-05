/** Fit actual enacted program costs after coupons and fixed fiscal expenses. */
export function openingProgramCostScale(input: {
  gdp: number;
  annualRevenue: number;
  annualDebtService: number;
  fixedOperatingCost: number;
  programCost: number;
  maximumDeficitGdpShare: number;
}): number {
  const affordable =
    input.annualRevenue +
    input.gdp * input.maximumDeficitGdpShare -
    input.annualDebtService -
    input.fixedOperatingCost;
  return input.programCost > 0 ? Math.min(1, Math.max(0, affordable / input.programCost)) : 1;
}

interface ProgramCostModel {
  gdpCostFraction?: number;
  incomeCostFraction?: number;
  gdpRevenueFraction?: number;
}

/** Preserve receipts and the policy ladder while resizing its real expenses. */
export function scaleProgramCostModel<T extends ProgramCostModel>(model: T, scale: number): T {
  return {
    ...model,
    ...(model.gdpCostFraction !== undefined && { gdpCostFraction: model.gdpCostFraction * scale }),
    ...(model.incomeCostFraction !== undefined && {
      incomeCostFraction: model.incomeCostFraction * scale,
    }),
  };
}
