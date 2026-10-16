/**
 * Income taxes. Each income group has its own legislated rate. Revenue weights
 * census population by relative earnings; player tiers follow annual earnings.
 */
export const INCOME_TIERS = ["low", "middle", "high"] as const;
export type IncomeTier = (typeof INCOME_TIERS)[number];
export const INCOME_TIER_LABELS: Record<IncomeTier, string> = {
  low: "Low Income",
  middle: "Medium Income",
  high: "High Income",
};
export const INCOME_TAX_KEYS = {
  low: "incomeTaxLow",
  middle: "incomeTaxMiddle",
  high: "incomeTaxHigh",
} as const;
export type IncomeTaxKey = (typeof INCOME_TAX_KEYS)[IncomeTier];
export interface IncomeTaxRates {
  incomeTax?: number;
  incomeTaxLow?: number;
  incomeTaxMiddle?: number;
  incomeTaxHigh?: number;
}
export type IncomeShares = Record<IncomeTier, number>;
/** Relative earnings, not currency thresholds or shares of people. */
export const RELATIVE_INCOME: IncomeShares = { low: 0.5, middle: 1, high: 2 };
export const DEFAULT_INCOME_POPULATION: IncomeShares = { low: 30, middle: 50, high: 20 };
export function isIncomeTier(value: unknown): value is IncomeTier {
  return typeof value === "string" && INCOME_TIERS.some((tier) => tier === value);
}
export function incomeTierForTaxKey(key: string): IncomeTier | undefined {
  return INCOME_TIERS.find((tier) => INCOME_TAX_KEYS[tier] === key);
}
export function incomeTaxRate(rates: IncomeTaxRates, tier: IncomeTier): number {
  const rate = rates[INCOME_TAX_KEYS[tier]] ?? rates.incomeTax ?? 0;
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("Invalid income-tax rate");
  return rate;
}
export function initializeIncomeTaxRates<T extends IncomeTaxRates>(
  rates: T
): T & Record<IncomeTaxKey, number> {
  return {
    ...rates,
    incomeTaxLow: incomeTaxRate(rates, "low"),
    incomeTaxMiddle: incomeTaxRate(rates, "middle"),
    incomeTaxHigh: incomeTaxRate(rates, "high"),
  };
}
/** Normalize once; population percentages are never treated as income percentages. */
export function incomeBaseShares(population: Partial<IncomeShares>): IncomeShares {
  const weights = INCOME_TIERS.map(
    (tier) =>
      Math.max(0, Number.isFinite(population[tier]) ? population[tier]! : 0) * RELATIVE_INCOME[tier]
  );
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 0) || !Number.isFinite(total)) return incomeBaseShares(DEFAULT_INCOME_POPULATION);
  const low = weights[0] / total;
  const middle = weights[1] / total;
  return { low, middle, high: Math.max(0, 1 - low - middle) };
}
export function incomeTaxRevenue(
  base: number,
  rates: IncomeTaxRates,
  shares?: IncomeShares
): number {
  if (!Number.isFinite(base) || base < 0) throw new Error("Invalid taxable income");
  const weights = shares ?? incomeBaseShares(DEFAULT_INCOME_POPULATION);
  const sum = INCOME_TIERS.reduce((s, tier) => s + weights[tier], 0);
  if (
    INCOME_TIERS.some((tier) => !Number.isFinite(weights[tier]) || weights[tier] < 0) ||
    Math.abs(sum - 1) > 1e-8
  )
    throw new Error("Invalid taxable-income shares");
  const low = incomeTaxRate(rates, "low"),
    middle = incomeTaxRate(rates, "middle"),
    high = incomeTaxRate(rates, "high");
  // Preserve the exact legacy result for equal rates, including after migration.
  if (low === middle && middle === high) return base * (low / 100);
  return (base * (weights.low * low + weights.middle * middle + weights.high * high)) / 100;
}
/** The legacy headline is a weighted effective rate, never a fourth tax lever. */
export function aggregateIncomeTaxRate(rates: IncomeTaxRates, shares?: IncomeShares): number {
  const low = incomeTaxRate(rates, "low"),
    middle = incomeTaxRate(rates, "middle"),
    high = incomeTaxRate(rates, "high");
  if (low === middle && middle === high) return low;
  return incomeTaxRevenue(100, rates, shares);
}
export function earnedIncomeTier(annualIncome: number, medianAnnualIncome: number): IncomeTier {
  if (
    !Number.isFinite(annualIncome) ||
    annualIncome < 0 ||
    !Number.isFinite(medianAnnualIncome) ||
    medianAnnualIncome <= 0
  )
    throw new Error("Invalid income-tier earnings");
  return annualIncome < medianAnnualIncome * 0.75
    ? "low"
    : annualIncome < medianAnnualIncome * 2
      ? "middle"
      : "high";
}
export function annualizedIncome(
  gross: number,
  observationTurns: number,
  turnsPerYear: number
): number {
  if (
    ![gross, observationTurns, turnsPerYear].every(Number.isFinite) ||
    gross < 0 ||
    observationTurns <= 0 ||
    turnsPerYear <= 0
  )
    throw new Error("Invalid income observation window");
  return (gross * turnsPerYear) / observationTurns;
}
export function countryIncomeShares(
  regions: readonly { population: number; income: IncomeShares; parentRegionId?: string }[]
): IncomeShares {
  const sums: IncomeShares = { low: 0, middle: 0, high: 0 };
  for (const region of regions) {
    if (region.parentRegionId || !Number.isFinite(region.population) || region.population <= 0)
      continue;
    const total = INCOME_TIERS.reduce(
      (sum, tier) =>
        sum + Math.max(0, Number.isFinite(region.income[tier]) ? region.income[tier] : 0),
      0
    );
    if (!(total > 0)) continue;
    for (const tier of INCOME_TIERS)
      sums[tier] +=
        (region.population *
          Math.max(0, Number.isFinite(region.income[tier]) ? region.income[tier] : 0)) /
        total;
  }
  return incomeBaseShares(sums);
}
/** National and regional taxes share a tier, with total liability capped at gross income. */
export function playerIncomeTax(
  gross: number,
  federalRate: number,
  regionalRate: number
): { gross: number; federal: number; regional: number; net: number } {
  if (
    ![gross, federalRate, regionalRate].every(Number.isFinite) ||
    gross < 0 ||
    federalRate < 0 ||
    regionalRate < 0 ||
    federalRate > 100 ||
    regionalRate > 100
  )
    throw new Error("Invalid player income tax");
  const federal = Math.min(gross, Math.floor((gross * federalRate) / 100));
  const regional = Math.min(gross - federal, Math.floor((gross * regionalRate) / 100));
  return { gross, federal, regional, net: gross - federal - regional };
}
export const TAXABLE_PLAYER_INCOME_TYPES = [
  "corp_salary",
  "corp_dividend",
  "bond_coupon",
  "index_fund_dividend",
  "savings_interest",
  "bank_deposit_interest",
] as const;
export function taxablePlayerIncome(type: string): boolean {
  return TAXABLE_PLAYER_INCOME_TYPES.some((value) => value === type);
}
/** A missing or invalid current quote falls back to the immutable assessment quote. */
export function incomeTaxDebtAnchor(
  amount: number,
  frozenRate: number,
  currentRate?: number
): number {
  const rate =
    currentRate !== undefined && Number.isFinite(currentRate) && currentRate > 0
      ? currentRate
      : frozenRate;
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid income-tax debt currency");
  return amount / rate;
}

/** Frozen legacy assessments retain their original debit; new cash wallets use anchor units. */
export function playerTaxWalletDebit(total: number, sourceFx: number, walletFx?: number): number {
  if (
    !Number.isFinite(total) ||
    total < 0 ||
    !Number.isFinite(sourceFx) ||
    sourceFx <= 0 ||
    (walletFx !== undefined && (!Number.isFinite(walletFx) || walletFx <= 0))
  )
    throw new Error("Invalid tax wallet conversion");
  return walletFx === undefined ? total : (total / sourceFx) * walletFx;
}
