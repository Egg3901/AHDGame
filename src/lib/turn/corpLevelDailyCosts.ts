/**
 * A corporation's daily fixed costs above its sectors: marketing budget, logistics
 * budget, R&D budget and CEO salary, summed by corpLevelDailyCosts in the corp's
 * own currency. Sector maintenance and growth costs are not here; they net out
 * inside each sector's profit.
 */
/**
 * Corp-level daily operating costs used by the exchange snapshot, in the corp's
 * own currency.
 *
 * These are the corp-wide lines that sit ABOVE the sectors: they are subtracted
 * once, not per sector. Sector maintenance and growth costs are not here, since
 * they already net out inside each sector's profit.
 *
 * R&D is the line the snapshot used to omit. 365 corporations carry a positive
 * `rdBudget` totalling roughly 1.18B per turn (turn 366), so leaving it out
 * overstated both the taxable income this feeds and the Income column the stock
 * list renders, against a corporation page that has always charged it
 * (corporationDetail.ts).
 *
 * STILL NOT INCLUDED, deliberately: the dominance regulatory burden (per sector,
 * and it needs a national market-share lookup the snapshot does not build) and
 * both pension legs (per scheme). Those remain corporation-page only. This is a
 * known, bounded narrowing rather than an oversight.
 */
export interface CorpLevelCostInputs {
  marketingBudget?: number;
  logisticsBudget?: number;
  rdBudget?: number;
  ceoSalary?: number;
}

const finite = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function corpLevelDailyCosts(corp: CorpLevelCostInputs): number {
  return (
    finite(corp.marketingBudget) +
    finite(corp.logisticsBudget) +
    finite(corp.rdBudget) +
    finite(corp.ceoSalary)
  );
}
