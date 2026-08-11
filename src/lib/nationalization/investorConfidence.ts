/**
 * Per-country investor-confidence index (spec §6.4, §12.4). Stored on the
 * country's FederalBudget doc. Absent ⇒ baseline. All reads clamp to [0,100].
 */
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { INVESTOR_CONFIDENCE_BASELINE } from "./constants";

export function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return INVESTOR_CONFIDENCE_BASELINE;
  return Math.max(0, Math.min(100, v));
}

export async function readInvestorConfidence(db: Db, countryId: CountryId): Promise<number> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ countryId }, { projection: { investorConfidence: 1 } });
  const raw = budget?.investorConfidence;
  return typeof raw === "number" ? clampConfidence(raw) : INVESTOR_CONFIDENCE_BASELINE;
}

export async function writeInvestorConfidence(
  db: Db,
  countryId: CountryId,
  value: number,
  turn: number
): Promise<void> {
  await db.collection<FederalBudget>("federalBudget").updateOne(
    { countryId },
    {
      $set: {
        investorConfidence: clampConfidence(value),
        investorConfidenceUpdatedAtTurn: turn,
      },
    }
  );
}
