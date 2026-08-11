/**
 * Stand up the seceding country's national fiscal footprint from its GDP share
 * of the pre-secession UK — the inverse of `reapportionNationalBudget` (which
 * moves a share into an EXISTING budget). Secession additionally SPLITS the
 * accumulated `treasuryBalance` + `debt.principal` by GDP share (a transfer
 * leaves those with the source; a new sovereign carries its proportional share).
 *
 * Sterlingization: the new budget keeps `currencyCode: "GBP"` — no conversion.
 * Idempotent: a no-op once the new country's `federalBudget` already exists.
 *
 * Run AFTER `expandToSubRegions` (the GDP weight reads the post-expand `states`
 * GDP sums: seceding sub-regions vs the rump-UK regions).
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget, State } from "@/lib/db/types";
import { getPath, setPath, scaleDeep } from "./docScale";

/**
 * Extensive (economy-sized) budget fields that split by GDP share. Intensive
 * values — `taxRates`, `economicFactors`, `debt.interestRate`/`ceiling`,
 * `debtToGdpRatio`, `creditRating`, `fiscalYear` — are copied, not scaled.
 */
const BUDGET_MAGNITUDE_FIELDS = [
  "revenue",
  "taxBases",
  "spending",
  "baselineSpendingByCategory",
  "baselineStateGrants",
  "treasuryBalance",
  "debt.principal",
  "gdp",
  "gdpSmoothed",
  "surplus",
];

export async function promoteEconomyToNational(
  db: Db,
  fromCountryId: CountryId,
  toCountryId: CountryId
): Promise<void> {
  const budgets = db.collection<FederalBudget>("federalBudget");

  // Idempotency: the new country already has a national budget.
  const existing = await budgets.findOne({ _id: toCountryId });
  if (existing) return;

  // GDP weight from the post-expand states: seceding sub-regions vs the rump-UK.
  const states = (await db
    .collection<State>("states")
    .find({ countryId: { $in: [fromCountryId, toCountryId] } })
    .toArray()) as Array<{ countryId?: string; gdp?: number }>;
  const newGdp = states
    .filter((s) => s.countryId === toCountryId)
    .reduce((a, s) => a + (s.gdp ?? 0), 0);
  const rumpGdp = states
    .filter((s) => s.countryId === fromCountryId)
    .reduce((a, s) => a + (s.gdp ?? 0), 0);
  const before = newGdp + rumpGdp;
  const weight = before > 0 ? newGdp / before : 0;
  if (!(weight > 0 && weight < 1)) return;

  const ukBudget = (await budgets.findOne({ _id: fromCountryId })) as Record<
    string,
    unknown
  > | null;
  if (!ukBudget) return;
  const now = new Date();

  // New country budget = the GDP-share slice of every magnitude field; all
  // structural fields (rates, factors, rating, year) carry over from the clone.
  const newBudget = structuredClone(ukBudget);
  newBudget._id = toCountryId;
  newBudget.countryId = toCountryId;
  newBudget.currencyCode = "GBP";
  newBudget.updatedAt = now;
  for (const field of BUDGET_MAGNITUDE_FIELDS) {
    const v = getPath(newBudget, field);
    if (v !== undefined) setPath(newBudget, field, scaleDeep(v, weight));
  }
  await budgets.insertOne(newBudget as unknown as FederalBudget);

  // Debit the UK by the moved share (dot-path $set preserves the kept fields).
  const set: Record<string, unknown> = { updatedAt: now };
  for (const field of BUDGET_MAGNITUDE_FIELDS) {
    const v = getPath(ukBudget, field);
    if (v !== undefined) set[field] = scaleDeep(v, 1 - weight);
  }
  await budgets.updateOne({ _id: fromCountryId }, { $set: set });
}
