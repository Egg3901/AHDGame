import { ObjectId, type Db } from "mongodb";
import type { StateBill } from "@/lib/db/types/stateBill";
import type { RegionalBudget } from "@/lib/db/types/regionalBudget";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import { isPolicyProvision } from "@/lib/db/types/legislation";
import { validateStateBudgetImpact } from "@/lib/budget/validation";
import { finalizeStateBillEnactment } from "@/lib/turn/billLifecycle/regionalEngine";

/** Replay an override that passed but was rejected solely by the old budget source. */
export async function repairRejectedRegionalBill(
  db: Db,
  billId: ObjectId,
  expectedRejectedAt: Date,
  currentTurn: number,
  apply: boolean
): Promise<{ applied: boolean; costAmount: number; newBalance: number }> {
  const bills = db.collection<StateBill>("stateBills");
  const bill = await bills.findOne({ _id: billId });
  if (
    !bill ||
    bill.status !== "failed" ||
    bill.budgetRejection?.error !== "INSUFFICIENT_FUNDS" ||
    bill.budgetRejection.rejectedAt.getTime() !== expectedRejectedAt.getTime() ||
    bill.governorAction !== "vetoed" ||
    !bill.overrideVoteSnapshot
  ) {
    throw new Error("Bill no longer matches the rejected veto-override repair target");
  }
  if (!bill.countryId) throw new Error("Bill country is missing");

  const budget = await db.collection<RegionalBudget>("regionalBudgets").findOne({
    _id: bill.stateId,
    countryId: bill.countryId,
  });
  if (!budget) throw new Error("Live regional budget is missing");

  const policyTypes = [
    ...new Set(
      bill.provisions?.filter(isPolicyProvision).map((p) => p.legislationTypeId) ??
        (bill.legislationTypeId ? [bill.legislationTypeId] : [])
    ),
  ];
  for (const legislationTypeId of policyTypes) {
    const currentPolicy = await db.collection<StatePolicy>("statePolicies").findOne({
      stateId: bill.stateId,
      legislationTypeId,
    });
    if (currentPolicy?.enactedAt && currentPolicy.enactedAt > bill.budgetRejection.rejectedAt) {
      throw new Error(`A newer ${legislationTypeId} policy blocks this repair`);
    }
  }

  const validation = await validateStateBudgetImpact(db, bill.stateId, bill.countryId, bill);
  if (!validation.allowed || validation.newBalance === undefined) {
    throw new Error("The live regional budget still cannot fund this bill");
  }
  const result = {
    applied: false,
    costAmount: validation.costAmount,
    newBalance: validation.newBalance,
  };
  if (!apply) return result;

  const claim = await bills.updateOne(
    {
      _id: billId,
      status: "failed",
      "budgetRejection.error": "INSUFFICIENT_FUNDS",
      "budgetRejection.rejectedAt": expectedRejectedAt,
      updatedAt: bill.updatedAt,
    },
    { $set: { status: "override_closing", updatedAt: new Date() } }
  );
  if (claim.modifiedCount !== 1) throw new Error("Bill changed before the repair could claim it");

  const outcome = await finalizeStateBillEnactment(db, bill, currentTurn);
  if (!outcome.enacted) throw new Error("Budget gate rejected the replay");
  for (const legislationTypeId of policyTypes) {
    const enactedPolicy = await db.collection<StatePolicy>("statePolicies").findOne({
      stateId: bill.stateId,
      legislationTypeId,
      enactedByBillId: billId,
    });
    if (!enactedPolicy) throw new Error(`Replayed policy ${legislationTypeId} was not recorded`);
  }

  const committed = await bills.updateOne(
    { _id: billId, status: "override_closing" },
    {
      $set: { status: "enacted", enactedAt: new Date(), updatedAt: new Date() },
      $unset: { failedAt: "", budgetRejection: "" },
    }
  );
  if (committed.modifiedCount !== 1) throw new Error("Replayed bill did not reach enacted status");
  return { ...result, applied: true };
}
