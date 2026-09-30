/** Recoverable publication of the receipt stored with the treasury cash update. */
import { createHash } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import type { FederalBudget, TreasuryAccrualReceipt } from "@/lib/db/types/budget";
import { treasuryAccrualLegs } from "./rules/treasuryAccrual";

export async function publishTreasuryAccrualReceipt(
  db: Db,
  budget: Pick<FederalBudget, "_id" | "countryId">,
  receipt: TreasuryAccrualReceipt
): Promise<void> {
  if (!receipt.ledgerShadow) return;
  const id = new ObjectId(
    createHash("sha256")
      .update(`treasury-accrual:${budget._id}:${receipt.turn}`)
      .digest("hex")
      .slice(0, 24)
  );
  const legs = treasuryAccrualLegs(budget.countryId, receipt);
  if (legs.length === 0) return;
  await db.collection("ledgerEntries").updateOne(
    { _id: id },
    {
      $setOnInsert: {
        turn: receipt.turn,
        createdAt: new Date(),
        txType: "gov_fiscal_accrual",
        legs,
        balanced: true,
        emitSite: "turn/treasuryTurn:accrual",
      },
    },
    { upsert: true }
  );
}
