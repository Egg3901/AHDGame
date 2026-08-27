import type { Db } from "mongodb";
import type { UKNhsState } from "@/lib/db/types/ukNhsState";
import type { FederalBudget } from "@/lib/db/types/budget";
import {
  NHS_QUALITY_START,
  NHS_BASELINE_HEALTHCARE_SHARE,
  fundingRatioFromHealthcareShare,
  tickNhsQuality,
} from "./nhsQuality";

/**
 * Persistence + per-turn drive for the UK NHS quality score (epic #856).
 *
 * The score is driven by the enacted fiscal ledger. Annual Budgets and ordinary
 * laws both update that same ledger, so neither authority gets a private NHS
 * funding channel. With no ledger, funding sits at the neutral baseline.
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
 * Advance NHS quality one turn from health's share of enacted annual spending.
 */
export async function tickNhsFromBudget(
  db: Db,
  args: { fiscalYear: number; now: Date }
): Promise<number> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: "UK" }, { projection: { spending: 1 } });
  const healthSpending =
    budget?.spending.byCategory.health ?? budget?.spending.byCategory.healthcare;
  const healthcareShare =
    budget && budget.spending.total > 0 && typeof healthSpending === "number"
      ? (healthSpending / budget.spending.total) * 100
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
