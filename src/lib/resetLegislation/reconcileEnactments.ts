import type { Db } from "mongodb";
import type { Bill } from "@/lib/db/types/legislation";
import type { StateBill } from "@/lib/db/types/stateBill";
import { applyResetLawBillEnactment } from "./enactBill";

/**
 * Retry shell for an enactment hook that failed after the bill status committed.
 * Selects at most one missing receipt per turn in one aggregate. The normal
 * enactment hook applies immediately; this bounded path only drains failures
 * without turning a backlog into an unbounded number of turn-time transactions.
 */
export async function reconcileResetLawEnactments(
  db: Db,
  turn: number
): Promise<{ candidates: number; applied: number }> {
  const [candidate] = await db
    .collection<Bill>("bills")
    .aggregate<Bill | StateBill>([
      { $match: { status: "signed", provisions: { $elemMatch: { type: "reset_law" } } } },
      { $project: { _id: 1, countryId: 1, provisions: 1 } },
      {
        $unionWith: {
          coll: "stateBills",
          pipeline: [
            {
              $match: {
                status: "enacted",
                provisions: { $elemMatch: { type: "reset_law" } },
              },
            },
            { $project: { _id: 1, countryId: 1, stateId: 1, provisions: 1 } },
          ],
        },
      },
      { $set: { receiptId: { $toString: "$_id" } } },
      {
        $lookup: {
          from: "resetLawEnactmentReceipts",
          localField: "receiptId",
          foreignField: "_id",
          as: "receipts",
        },
      },
      { $match: { "receipts.0": { $exists: false } } },
      { $unset: ["receiptId", "receipts"] },
      { $limit: 1 },
    ])
    .toArray();
  if (!candidate) return { candidates: 0, applied: 0 };
  const result = await applyResetLawBillEnactment(db, candidate, turn);
  return { candidates: 1, applied: result.applied ? 1 : 0 };
}
