/**
 * Stand up the seceding country's national fiscal footprint from its GDP share
 * of the pre-secession UK — the inverse of `reapportionNationalBudget` (which
 * moves a share into an EXISTING budget). Secession SPLITS accumulated
 * `treasuryBalance` cash by GDP share (a transfer leaves cash with the source;
 * a new sovereign carries its proportional share) and moves the matching share
 * of the sovereign bond stock with it, so each side's stored `debt.principal`
 * still equals its haircut-adjusted active non-defaulted bond face (refs
 * #1975). Cash and debt are separate positions: only the bonds carry
 * obligations across, never a balance-derived mirror.
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
import type { Bond } from "@/lib/db/types/bond";
import {
  sumOutstandingSovereignPrincipal,
  sovereignDebtTerms,
} from "@/lib/bonds/sovereignPrincipal";
import { getPath, setPath, scaleDeep } from "./docScale";

/**
 * Extensive (economy-sized) budget fields that split by GDP share. Intensive
 * values — `taxRates`, `economicFactors`, `debt.interestRate`/`ceiling`,
 * `debtToGdpRatio`, `creditRating`, `fiscalYear` — are copied, not scaled.
 * `debt.principal` is absent on purpose: it follows the split bond stock, not
 * the GDP weight (see below).
 */
const BUDGET_MAGNITUDE_FIELDS = [
  "revenue",
  "taxBases",
  "spending",
  "baselineSpendingByCategory",
  "baselineStateGrants",
  "treasuryBalance",
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

  // The new sovereign assumes its GDP-share of the national debt WITH the
  // bonds that back it. Scaling is linear, so each side's outstanding stock is
  // exactly its weight of the pre-split stock: no re-read, no rounding, and
  // the two principals conserve the pre-split total by construction.
  const sourceBonds = await db
    .collection<Bond>("bonds")
    .find({ issuerType: "sovereign", countryId: fromCountryId, matured: false })
    .toArray();
  const preOutstanding = sumOutstandingSovereignPrincipal(sourceBonds);
  const scoOutstanding = preOutstanding * weight;
  const ukOutstanding = preOutstanding * (1 - weight);
  const ukGdp = typeof ukBudget["gdp"] === "number" ? (ukBudget["gdp"] as number) : 0;
  const ukGdpSmoothed =
    typeof ukBudget["gdpSmoothed"] === "number" ? (ukBudget["gdpSmoothed"] as number) : undefined;
  const debtTermsFor = (principal: number, gdp: number, gdpSmoothed: number | undefined) =>
    sovereignDebtTerms(principal, {
      gdp,
      gdpSmoothed,
      investorConfidence: ukBudget["investorConfidence"] as number | undefined,
      imfBailoutActive: ukBudget["imfSovereignBailoutActive"] as boolean | undefined,
      sovereignRiskAnchor: ukBudget["sovereignRiskAnchor"] as FederalBudget["sovereignRiskAnchor"],
    });
  const scoTerms = debtTermsFor(
    scoOutstanding,
    ukGdp * weight,
    ukGdpSmoothed != null ? ukGdpSmoothed * weight : undefined
  );
  const ukTerms = debtTermsFor(
    ukOutstanding,
    ukGdp * (1 - weight),
    ukGdpSmoothed != null ? ukGdpSmoothed * (1 - weight) : undefined
  );

  // New country budget = the GDP-share slice of every magnitude field; all
  // structural fields (rates, factors, year) carry over from the clone. Its
  // debt stock is its share of the split bond ledger, with the service terms
  // refreshed off that stock.
  const newBudget = structuredClone(ukBudget);
  newBudget._id = toCountryId;
  newBudget.countryId = toCountryId;
  newBudget.currencyCode = "GBP";
  newBudget.updatedAt = now;
  for (const field of BUDGET_MAGNITUDE_FIELDS) {
    const v = getPath(newBudget, field);
    if (v !== undefined) setPath(newBudget, field, scaleDeep(v, weight));
  }
  setPath(newBudget, "debt.principal", scoOutstanding);
  setPath(newBudget, "debt.interestRate", scoTerms.interestRate);
  setPath(newBudget, "debtToGdpRatio", scoTerms.debtToGdpRatio);
  setPath(newBudget, "creditRating", scoTerms.creditRating);
  await budgets.insertOne(newBudget as unknown as FederalBudget);

  // Debit the UK by the moved share (dot-path $set preserves the kept fields).
  const set: Record<string, unknown> = {
    updatedAt: now,
    "debt.principal": ukOutstanding,
    "debt.interestRate": ukTerms.interestRate,
    debtToGdpRatio: ukTerms.debtToGdpRatio,
    creditRating: ukTerms.creditRating,
  };
  for (const field of BUDGET_MAGNITUDE_FIELDS) {
    const v = getPath(ukBudget, field);
    if (v !== undefined) set[field] = scaleDeep(v, 1 - weight);
  }
  await budgets.updateOne({ _id: fromCountryId }, { $set: set });

  // Move the debt itself: scale every non-matured sovereign bond down to the
  // rump share and insert the seceding share as new bonds keyed to the new
  // country. Same-currency split, so units scale by the bare weight (the
  // merger path scales by an FX rate instead). Runs after the budget writes so
  // a crash still leaves the early-return guard able to converge: the budgets
  // already carry the split stocks, and the end-of-turn bond-ledger reconcile
  // heals any bond half that did not land.
  if (sourceBonds.length > 0) {
    await db.collection<Bond>("bonds").bulkWrite(
      sourceBonds.map((bond) => ({
        updateOne: {
          filter: { _id: bond._id },
          update: {
            $set: {
              totalIssued: (bond.totalIssued ?? 0) * (1 - weight),
              publicFloat: (bond.publicFloat ?? 0) * (1 - weight),
              ...(bond.centralBankHoldings != null
                ? { centralBankHoldings: bond.centralBankHoldings * (1 - weight) }
                : {}),
              ...(bond.originalTotalIssued != null
                ? { originalTotalIssued: bond.originalTotalIssued * (1 - weight) }
                : {}),
              holders: (bond.holders ?? []).map((h) => ({ ...h, units: h.units * (1 - weight) })),
              updatedAt: now,
            },
          },
        },
      }))
    );
    await db.collection<Omit<Bond, "_id">>("bonds").insertMany(
      sourceBonds.map((bond) => {
        const { _id, ...rest } = bond;
        void _id;
        return {
          ...rest,
          countryId: toCountryId,
          totalIssued: (bond.totalIssued ?? 0) * weight,
          publicFloat: (bond.publicFloat ?? 0) * weight,
          ...(bond.centralBankHoldings != null
            ? { centralBankHoldings: bond.centralBankHoldings * weight }
            : {}),
          ...(bond.originalTotalIssued != null
            ? { originalTotalIssued: bond.originalTotalIssued * weight }
            : {}),
          holders: (bond.holders ?? []).map((h) => ({ ...h, units: h.units * weight })),
          updatedAt: now,
          createdAt: bond.createdAt ?? now,
        };
      })
    );
  }
}
