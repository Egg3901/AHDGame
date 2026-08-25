import type { Db } from "mongodb";
import type { UKNhsState } from "@/lib/db/types/ukNhsState";
import { getBudgetForFiscalYear } from "@/lib/db/collections/ukBudgets";
import {
  NHS_QUALITY_START,
  NHS_BASELINE_HEALTHCARE_SHARE,
  fundingRatioFromHealthcareShare,
  tickNhsQuality,
} from "./nhsQuality";

/**
 * Persistence + per-turn drive for the UK NHS quality score (epic #856).
 *
 * The score is driven by the Budget: the healthcare share of the current
 * PASSED Budget sets the funding ratio, which pulls quality gradually toward its
 * target each turn. With no passed Budget, funding sits at the baseline
 * (neutral ratio 1.0). Quality feeds approval + manifesto salience elsewhere.
 */

export function getUKNhsCollection(db: Db) {
  return db.collection<UKNhsState>("ukNhsState");
}

export async function getNhsQuality(db: Db): Promise<number> {
  const doc = await getUKNhsCollection(db).findOne({ _id: "current" });
  return typeof doc?.quality === "number" ? doc.quality : NHS_QUALITY_START;
}

export async function getNhsState(db: Db): Promise<UKNhsState | null> {
  return getUKNhsCollection(db).findOne({ _id: "current" });
}

/**
 * Advance NHS quality one turn from the current PASSED Budget's healthcare
 * share. Returns the new quality. Pure inputs are resolved here so the caller
 * just supplies the fiscal year + time.
 */
export async function tickNhsFromBudget(
  db: Db,
  args: { fiscalYear: number; now: Date }
): Promise<number> {
  const budget = await getBudgetForFiscalYear(db, args.fiscalYear);
  const healthcareShare =
    budget?.status === "passed"
      ? (budget.spendingAllocations?.healthcare ?? NHS_BASELINE_HEALTHCARE_SHARE)
      : NHS_BASELINE_HEALTHCARE_SHARE;

  const current = await getNhsQuality(db);
  const ratio = fundingRatioFromHealthcareShare(healthcareShare);
  const quality = tickNhsQuality(current, ratio);

  await getUKNhsCollection(db).updateOne(
    { _id: "current" },
    { $set: { quality, lastHealthcareShare: healthcareShare, updatedAt: args.now } },
    { upsert: true }
  );
  return quality;
}
