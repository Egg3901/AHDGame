import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getTreasuryOperationsCollection } from "@/lib/db/collections/treasuryOperations";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { INVESTOR_CONFIDENCE_BASELINE } from "@/lib/nationalization/constants";

/**
 * Cabinet Monetary turn step (4f). For each country with an ACTIVE debt-management
 * operation, accelerate investor-confidence recovery while the op window is open
 * (clamped at baseline — zero effect at/above it), and close the op at expiry.
 * Writes federalBudget.investorConfidence DIRECTLY (the field the sovereign
 * confidence premium reads); it is NOT routed through the capped metric pipeline.
 * No active ops ⇒ no writes.
 */
export async function applyTreasuryEffects(
  db: Db,
  currentTurn: number
): Promise<{ opsApplied: number; opsExpired: number }> {
  const opsCol = getTreasuryOperationsCollection(db);
  const active = await opsCol.find({ activeOp: { $ne: null } }).toArray();

  let opsApplied = 0;
  let opsExpired = 0;

  for (const doc of active) {
    const op = doc.activeOp;
    if (!op) continue;

    if (currentTurn >= op.expiresTurn) {
      await opsCol.updateOne(
        { _id: doc._id },
        {
          $set: { activeOp: null, updatedAt: new Date() },
          $push: {
            history: {
              launchedTurn: op.launchedTurn,
              expiresTurn: op.expiresTurn,
              launchedBy: op.launchedBy,
              launchedByName: op.launchedByName,
            },
          },
        }
      );
      opsExpired++;
      continue;
    }

    const budgetId = getNationalBudgetId(doc.countryId);
    const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
    const current = budget?.investorConfidence;
    if (typeof current !== "number" || current >= INVESTOR_CONFIDENCE_BASELINE) {
      // At/above baseline (or unset) — accelerated recovery has no effect.
      continue;
    }
    const next = Math.min(INVESTOR_CONFIDENCE_BASELINE, current + op.boostPerTurn);
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: budgetId }, { $set: { investorConfidence: next } });
    opsApplied++;
  }

  return { opsApplied, opsExpired };
}
