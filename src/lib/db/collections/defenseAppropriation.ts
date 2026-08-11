import type { Db } from "mongodb";
import type { DefenseAppropriation, FederalBudget } from "@/lib/db/types/budget";
import type { AppropriationSettlement } from "@/lib/military/appropriation";
import { resolveDefenseLineFrom } from "@/lib/turn/defenseEnvelope";

const EMPTY: DefenseAppropriation = { balance: 0, accruedThroughTurn: 0, arrearsRatio: 0 };

function budgets(db: Db) {
  return db.collection<FederalBudget>("federalBudget");
}

/**
 * The pot a budget document carries, seeding an absent one to a year's accrual IN MEMORY.
 *
 * Split out so a caller that has already loaded the budget — the turn sweep needs the
 * defence line from the same document — can resolve the pot without a second `findOne`, and
 * without the heal's write when it is about to `$set` the whole sub-document anyway.
 */
export function appropriationFrom(budget: FederalBudget | null): DefenseAppropriation {
  if (!budget) return { ...EMPTY };
  if (budget.defenseAppropriation) return budget.defenseAppropriation;
  return {
    balance: Math.round(resolveDefenseLineFrom(budget)),
    accruedThroughTurn: 0,
    arrearsRatio: 0,
  };
}

/**
 * The country's defence account, healing an unmigrated budget in place.
 *
 * Heals rather than defaulting to zero: an empty pot refuses every purchase, so a country
 * the migration missed would present a permanently dead recruit button rather than a
 * diagnosable data gap. The heal uses the migration's own rule — one year's accrual — so a
 * healed world and a migrated one are identical by construction rather than by two
 * constants that happen to agree.
 *
 * The `$exists: false` guard on the write means two concurrent readers cannot both seed it,
 * and a country with no budget document at all gets the empty pot without one being created
 * here (budget creation is `ensureFederalBudget`'s job, not this module's).
 */
export async function getDefenseAppropriation(
  db: Db,
  countryId: string
): Promise<DefenseAppropriation> {
  const budget = await budgets(db).findOne({ countryId });
  if (!budget) return { ...EMPTY };
  if (budget.defenseAppropriation) return budget.defenseAppropriation;

  const seeded = appropriationFrom(budget);
  await budgets(db).updateOne(
    { countryId, defenseAppropriation: { $exists: false } },
    { $set: { defenseAppropriation: seeded } }
  );
  return seeded;
}

/**
 * Persist a turn's settlement, atomically.
 *
 * Applies the turn's NET change as an `$inc`, never the absolute closing balance. The turn
 * step owns the *turn*, but it does not own the database: a player recruiting between this
 * step's read and its write would have their `debitAppropriation` silently reverted by an
 * absolute `$set`, minting the unit for free. An `$inc` composes with concurrent spends.
 *
 * `accruedThroughTurn: { $lt: turn }` makes the whole write idempotent at the database rather
 * than only in the caller's pre-check — two overlapping turn runs cannot both credit the
 * accrual. The pot must already exist for this filter to match, which is why the caller seeds
 * an unmigrated budget before settling.
 */
export async function applyAppropriationSettlement(
  db: Db,
  countryId: string,
  turn: number,
  settlement: AppropriationSettlement
): Promise<boolean> {
  const res = await budgets(db).updateOne(
    { countryId, "defenseAppropriation.accruedThroughTurn": { $lt: turn } },
    {
      $inc: { "defenseAppropriation.balance": Math.round(settlement.delta) },
      $set: {
        "defenseAppropriation.accruedThroughTurn": turn,
        "defenseAppropriation.arrearsRatio": settlement.arrearsRatio,
      },
    }
  );
  return res.modifiedCount > 0;
}

/**
 * Spend from the pot, returning false when the balance will not cover it.
 *
 * Atomic and guarded: the `$gte` filter means two concurrent orders cannot both succeed
 * against the same balance — the loser gets `false` (a retryable 409) instead of silently
 * overdrawing. Deliberately NOT the read-modify-write `$set` that `moveTreasury` uses; the
 * pot is written by both a turn step and player routes, so it needs the stronger guarantee.
 *
 * There is no overdraft here. The overdraft exists for UPKEEP, an obligation already
 * incurred; a new purchase must fit inside the balance outright.
 */
export async function debitAppropriation(
  db: Db,
  countryId: string,
  amount: number
): Promise<boolean> {
  const amt = Math.round(amount);
  if (!(amt > 0)) return true;
  const res = await budgets(db).updateOne(
    { countryId, "defenseAppropriation.balance": { $gte: amt } },
    { $inc: { "defenseAppropriation.balance": -amt } }
  );
  return res.modifiedCount > 0;
}

/**
 * Return money to the pot. Unguarded by design — a rollback must never be refused, or a
 * failed insert would leave the player charged for a unit they did not get.
 */
export async function creditAppropriation(
  db: Db,
  countryId: string,
  amount: number
): Promise<void> {
  const amt = Math.round(amount);
  if (!(amt > 0)) return;
  await budgets(db).updateOne({ countryId }, { $inc: { "defenseAppropriation.balance": amt } });
}
