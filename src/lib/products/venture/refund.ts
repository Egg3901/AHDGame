/**
 * Receipt-keyed refund of a venture's turn debit. The receipt is deleted in
 * the same atomic update that returns the cash, so the turn processor and the
 * cancel route can both attempt it and exactly one wins.
 */
import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";

/**
 * Refunds the receipt for `turn` (or any receipt when `turn` is omitted).
 * Returns true only when this call moved the money.
 */
export async function refundVentureReceipt(
  db: Db,
  corporationId: ObjectId,
  ventureId: string,
  turn?: number
): Promise<boolean> {
  const collection = db.collection<Corporation>("corporations");
  const key = `productVentureDebitsV1.${ventureId}`;
  let receiptTurn = turn;
  let local: number | undefined;
  if (turn === undefined) {
    const row = (await collection.findOne(
      { _id: corporationId },
      { projection: { productVentureDebitsV1: 1 } }
    )) as { productVentureDebitsV1?: Corporation["productVentureDebitsV1"] } | null;
    const receipt = row?.productVentureDebitsV1?.[ventureId];
    if (!receipt) return false;
    receiptTurn = receipt.turn;
    local = receipt.localAmount;
  } else {
    const row = (await collection.findOne(
      { _id: corporationId },
      { projection: { productVentureDebitsV1: 1 } }
    )) as { productVentureDebitsV1?: Corporation["productVentureDebitsV1"] } | null;
    local = row?.productVentureDebitsV1?.[ventureId]?.localAmount;
  }
  if (local === undefined || !(local > 0)) return false;
  const result = await collection.updateOne({ _id: corporationId, [`${key}.turn`]: receiptTurn }, {
    $inc: { liquidCapital: local },
    $unset: { [key]: "" },
  } as never);
  return result.matchedCount === 1;
}

/** Drops a settled receipt without moving money. */
export async function clearVentureReceipt(
  db: Db,
  corporationId: ObjectId,
  ventureId: string,
  throughTurn: number
): Promise<void> {
  await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corporationId,
      [`productVentureDebitsV1.${ventureId}.turn`]: { $lte: throughTurn },
    },
    { $unset: { [`productVentureDebitsV1.${ventureId}`]: "" } } as never
  );
}

/**
 * After a cancel wins the venture revision race: a receipt newer than the
 * venture's last processed turn is a debit whose development step never
 * landed, so it is refunded; an older or equal one was applied and is only
 * cleared. Returns whether cash was returned.
 */
export async function settleCancelledVentureReceipt(
  db: Db,
  corporationId: ObjectId,
  ventureId: string,
  lastProcessedTurn: number
): Promise<boolean> {
  const row = (await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corporationId }, { projection: { productVentureDebitsV1: 1 } })) as {
    productVentureDebitsV1?: Corporation["productVentureDebitsV1"];
  } | null;
  const receipt = row?.productVentureDebitsV1?.[ventureId];
  if (!receipt) return false;
  if (receipt.turn > lastProcessedTurn) {
    return refundVentureReceipt(db, corporationId, ventureId, receipt.turn);
  }
  await clearVentureReceipt(db, corporationId, ventureId, lastProcessedTurn);
  return false;
}
