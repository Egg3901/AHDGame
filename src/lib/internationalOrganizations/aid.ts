import type { Db } from "mongodb";
import { type CountryId } from "@/lib/constants/countries";
import type { InternationalOrganizationId } from "@/lib/constants/internationalOrganizations";
import type { FederalBudget } from "@/lib/db/types";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import {
  convertLocal,
  disburseFromOrganizationFund,
  localToUsd,
  resolveOrgFundCurrencyCountry,
} from "./organizationFund";

/**
 * Aid packages disburse from the organization's pooled fund (capitalized by
 * member dues) to a recipient member's treasury, plus a one-time growth boost.
 * The amount is USD; the recipient credit converts to local via the static
 * `usdExchangeRate` (local = USD / rate).
 */

/** GDP-growth boost the recipient gets, scaled to aid size (log10 USD) and capped. */
const AID_BOOST_PER_LOG10_USD = 0.05;
const AID_BOOST_MAX_GROWTH = 0.5;
/** stateMetrics path the boost is applied to (one-time, then engine-smoothed). */
const AID_BOOST_METRIC_PATH = "economic.gdpGrowth.value";

/**
 * One-time GDP-growth boost (percentage points) an aid package gives its
 * recipient, scaled to aid size on a log10-USD curve and capped. Pure.
 */
export function aidGrowthBoost(amountUsd: number): number {
  if (!(amountUsd > 0)) return 0;
  const raw = AID_BOOST_PER_LOG10_USD * Math.log10(Math.max(1, amountUsd));
  return Math.min(AID_BOOST_MAX_GROWTH, Math.max(0, raw));
}

/**
 * Apply the recipient's one-time growth boost across its states' `stateMetrics`
 * (`$inc` on `economic.gdpGrowth.value`, the crisis-shock pattern — the metric
 * engine smooths it back over subsequent turns). No-op when the boost rounds to 0.
 */
export async function applyOrganizationAidBoost(
  db: Db,
  recipient: CountryId,
  amountUsd: number
): Promise<void> {
  const boost = aidGrowthBoost(amountUsd);
  if (boost <= 0) return;
  const states = await db
    .collection<{ _id: string; countryId: CountryId }>("states")
    .find({ countryId: recipient })
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  if (states.length === 0) return;
  // SP5: economic.* lives on macroMetrics.
  await db
    .collection<{ _id: string }>("macroMetrics")
    .updateMany(
      { _id: { $in: states.map((s) => s._id) } },
      { $inc: { [AID_BOOST_METRIC_PATH]: boost }, $set: { lastUpdated: new Date() } }
    );
}

/**
 * Pay an aid package out of the org fund. `amountFund` is in the fund's (founding)
 * currency: disburse it from the fund (only if covered), credit the recipient's
 * treasury (converted to the recipient's currency), and apply a growth boost
 * scaled to the USD value. Returns false (no money moved) when underfunded.
 */
export async function payOrganizationAid(
  db: Db,
  organizationId: InternationalOrganizationId,
  recipient: CountryId,
  amountFund: number
): Promise<boolean> {
  if (!(amountFund > 0)) return false;
  const paid = await disburseFromOrganizationFund(db, organizationId, amountFund);
  if (!paid) return false;
  const fundCountry = await resolveOrgFundCurrencyCountry(db, organizationId);
  const preset = await loadWorldPreset(db);
  const recipientLocal = convertLocal(fundCountry, recipient, amountFund, preset);
  await db.collection<FederalBudget>("federalBudget").updateOne(
    { countryId: recipient },
    {
      $inc: { treasuryBalance: recipientLocal },
      $set: { updatedAt: new Date() },
    }
  );
  await applyOrganizationAidBoost(db, recipient, localToUsd(fundCountry, amountFund, preset));
  return true;
}
