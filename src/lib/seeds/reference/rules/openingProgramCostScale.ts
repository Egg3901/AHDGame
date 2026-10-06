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

/**
 * Fit a law book priced on another era's anchors to an authored historical
 * spending composition. Each budget category receives its own expense scale,
 * so an underpriced category grows and an overpriced one shrinks, and the
 * fitted book fills the opening deficit envelope from either side. Authored
 * categories without a matching program fold into `other`; program categories
 * without an authored figure keep their own cost as the target.
 */
export function openingProgramCategoryScales(input: {
  gdp: number;
  annualRevenue: number;
  annualDebtService: number;
  fixedOperatingCost: number;
  programCostByCategory: Readonly<Record<string, number>>;
  targetByCategory: Readonly<Record<string, number>>;
  maximumDeficitGdpShare: number;
}): Record<string, number> {
  const priced = Object.entries(input.programCostByCategory).filter(([, cost]) => cost > 0);
  const desired = new Map(
    priced.map(([category, cost]) => [
      category,
      Math.max(0, input.targetByCategory[category] ?? cost),
    ])
  );
  if (desired.has("other")) {
    for (const [category, amount] of Object.entries(input.targetByCategory)) {
      if (!desired.has(category)) desired.set("other", desired.get("other")! + Math.max(0, amount));
    }
  }
  const desiredTotal = [...desired.values()].reduce((sum, amount) => sum + amount, 0);
  const affordable = Math.max(
    0,
    input.annualRevenue +
      input.gdp * input.maximumDeficitGdpShare -
      input.annualDebtService -
      input.fixedOperatingCost
  );
  const fit = desiredTotal > 0 ? affordable / desiredTotal : 1;
  return Object.fromEntries(
    priced.map(([category, cost]) => [category, (desired.get(category)! * fit) / cost])
  );
}
