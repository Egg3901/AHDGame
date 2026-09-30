/** Release only this terminal command's reservation after an overlapping retry. */
import type { Db } from "mongodb";

export async function releaseMonetaryCommandReservation(
  db: Db,
  bankId: string,
  reservationId: string
): Promise<void> {
  await db
    .collection<{ _id: string; pendingLiquidityOperationId?: string }>("centralBanks")
    .updateOne(
      { _id: bankId, pendingLiquidityOperationId: reservationId },
      { $unset: { pendingLiquidityOperationId: "" } }
    );
}
