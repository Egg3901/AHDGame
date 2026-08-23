/** Maximum combined corporate and public growth investment as a share of GDP. */
export const ADDITIONAL_CAPITAL_GDP_CAP = 0.05;

const BASE_FORMATION_SHARE = 0.35;
const CATCHUP_FORMATION_UPSIDE = 0.3;

const finitePositive = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * Share of a productive public-capital budget that becomes new capital rather
 * than maintenance or current consumption. Catch-up headroom raises the share,
 * but it is bounded and falls back to the neutral share on invalid inputs.
 */
export function publicCapitalFormationShare(ownPcAnchor: number, frontierPcAnchor: number): number {
  const own = finitePositive(ownPcAnchor);
  const frontier = finitePositive(frontierPcAnchor);
  if (own === 0 || frontier === 0) return BASE_FORMATION_SHARE;
  const incomeGap = Math.max(0, Math.min(1, 1 - own / frontier));
  return BASE_FORMATION_SHARE + CATCHUP_FORMATION_UPSIDE * incomeGap;
}

export interface AdditionalCapitalInvestmentInputs {
  outputAnnualLocalMillions: number;
  publicCapitalBudgetAnnualLocalMillions: number;
  corporateInvestmentPerTurnLocalMillions: number;
  ownPcAnchor: number;
  frontierPcAnchor: number;
  turnsPerYear: number;
}

/** Combine budget-backed public capital and paid corporate expansion. */
export function combineAdditionalCapitalInvestment(
  inputs: AdditionalCapitalInvestmentInputs
): number {
  const output = finitePositive(inputs.outputAnnualLocalMillions);
  const turns = finitePositive(inputs.turnsPerYear);
  if (output === 0 || turns === 0) return 0;
  const corporate = finitePositive(inputs.corporateInvestmentPerTurnLocalMillions);
  const publicBudget = finitePositive(inputs.publicCapitalBudgetAnnualLocalMillions);
  const publicPerTurn =
    (publicBudget * publicCapitalFormationShare(inputs.ownPcAnchor, inputs.frontierPcAnchor)) /
    turns;
  const capPerTurn = (ADDITIONAL_CAPITAL_GDP_CAP * output) / turns;
  return Math.min(capPerTurn, corporate + publicPerTurn);
}
