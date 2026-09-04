import type { Db } from "mongodb";
import type { FederalBudget, IntelligenceAppropriation } from "@/lib/db/types/budget";

const EMPTY: IntelligenceAppropriation = { balance: 0, accruedThroughTurn: 0 };

function budgets(db: Db) {
  return db.collection<FederalBudget>("federalBudget");
}

/**
 * The country's intelligence account, seeding an absent one to ZERO in place.
 *
 * The defence equivalent HEALS an absent pot to a year's accrual, because there an empty pot
 * presents the player with a permanently dead recruit button rather than a diagnosable data
 * gap. The opposite is true here: an empty pot is the correct and expected state for a
 * country whose legislature has voted no money, so healing it would hand every country in
 * the world a funded service it never legislated.
 *
 * The `$exists: false` guard means two concurrent readers cannot both seed it, and a country
 * with no budget document gets the empty pot without one being created here.
 */
export async function getIntelligenceAppropriation(
  db: Db,
  countryId: string
): Promise<IntelligenceAppropriation> {
  const budget = await budgets(db).findOne({ countryId });
  if (!budget) return { ...EMPTY };
  if (budget.intelligenceAppropriation) return budget.intelligenceAppropriation;
  await budgets(db).updateOne(
    { countryId, intelligenceAppropriation: { $exists: false } },
    { $set: { intelligenceAppropriation: { ...EMPTY } } }
  );
  return { ...EMPTY };
}

/**
 * Persist a turn's NET change (accrual minus the upkeep actually paid), atomically.
 *
 * An `$inc`, never an absolute `$set`: an operation resolving between the caller's read and
 * this write would have its debit silently reverted by an absolute value, running that
 * operation for free. `accruedThroughTurn: { $lt: turn }` makes the whole write idempotent
 * at the database rather than only in the caller's pre-check, so two overlapping turn runs
 * can neither both credit the accrual nor both charge the upkeep. The pot must already exist
 * for the filter to match, which is why the caller seeds it first.
 */
export async function applyIntelligenceSettlement(
  db: Db,
  countryId: string,
  turn: number,
  delta: number
): Promise<boolean> {
  const res = await budgets(db).updateOne(
    { countryId, "intelligenceAppropriation.accruedThroughTurn": { $lt: turn } },
    {
      $inc: { "intelligenceAppropriation.balance": Math.round(delta) },
      $set: { "intelligenceAppropriation.accruedThroughTurn": turn },
    }
  );
  return res.modifiedCount > 0;
}

/**
 * Spend from the pot, returning false when the balance will not cover it.
 *
 * Guarded `$gte`, so two concurrent operations cannot both succeed against the same balance:
 * the loser gets `false` (a retryable 409) rather than silently overdrawing. There is no
 * overdraft to fall back on, by design.
 */
export async function debitIntelligenceAppropriation(
  db: Db,
  countryId: string,
  amount: number
): Promise<boolean> {
  const amt = Math.round(amount);
  if (!(amt > 0)) return true;
  const res = await budgets(db).updateOne(
    { countryId, "intelligenceAppropriation.balance": { $gte: amt } },
    { $inc: { "intelligenceAppropriation.balance": -amt } }
  );
  return res.modifiedCount > 0;
}

/**
 * Return money to the pot. Unguarded by design — a refund must never be refused, or a failed
 * operation would leave the service charged for work it never did.
 */
export async function creditIntelligenceAppropriation(
  db: Db,
  countryId: string,
  amount: number
): Promise<void> {
  const amt = Math.round(amount);
  if (!(amt > 0)) return;
  await budgets(db).updateOne(
    { countryId },
    { $inc: { "intelligenceAppropriation.balance": amt } }
  );
}
