/** Pure 1991 opening fiscal bridge. Adjustments are named source obligations. */
export interface OpeningSourceBudget {
  revenue: number;
  spendingIncludingInterest: number;
  gdp: number;
  debt: number;
  annualInterestRate: number;
}

export interface OpeningFiscalCorrection {
  id: string;
  revenueDelta: number;
  spendingDelta: number;
  reason: string;
}

export interface BridgedOpeningLedger {
  revenue: number;
  operating: number;
  interest: number;
  debt: number;
  gdp: number;
  annualBalance: number;
  corrections: readonly OpeningFiscalCorrection[];
}

export function bridgeOpeningLedger(
  source: OpeningSourceBudget,
  corrections: readonly OpeningFiscalCorrection[]
): BridgedOpeningLedger {
  for (const [name, value] of Object.entries(source)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`invalid opening ${name}`);
  }
  const ids = new Set<string>();
  let revenue = source.revenue;
  let spending = source.spendingIncludingInterest;
  for (const correction of corrections) {
    if (!correction.id.trim() || ids.has(correction.id) || !correction.reason.trim()) {
      throw new Error(`invalid or duplicate opening correction ${correction.id}`);
    }
    ids.add(correction.id);
    if (!Number.isFinite(correction.revenueDelta) || !Number.isFinite(correction.spendingDelta)) {
      throw new Error(`nonfinite opening correction ${correction.id}`);
    }
    revenue += correction.revenueDelta;
    spending += correction.spendingDelta;
  }
  // Seed budgets store currency in whole units, including debt service.
  const interest = Math.round(source.debt * source.annualInterestRate);
  const operating = spending - interest;
  if (revenue < 0 || operating < 0) throw new Error("opening correction makes a book negative");
  return {
    revenue,
    operating,
    interest,
    debt: source.debt,
    gdp: source.gdp,
    annualBalance: revenue - operating - interest,
    corrections: [...corrections],
  };
}
