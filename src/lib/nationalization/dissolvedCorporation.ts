import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { snapshotCorporationCurrency } from "@/lib/ledger/balanceSnapshot";
import { witnessTreasuryCash, type TreasuryCashOptions } from "./treasuryLedger";

/**
 * Delete a dissolved corporation and witness the cash it still held, which
 * leaves the books with it. Whoever received that cash (its CEO, the treasury or
 * a National Corporation) is witnessed by the caller under the same liquidation
 * reason, so the money-supply check nets the two. The balance is read just
 * before the delete, so any in-turn movement already witnessed is included.
 */
export async function deleteDissolvedCorporation(
  db: Db,
  corporationId: ObjectId,
  ledger: TreasuryCashOptions | undefined,
  now: Date,
  site: string
): Promise<void> {
  const corps = db.collection<Corporation>("corporations");
  const closing = await corps.findOne(
    { _id: corporationId },
    { projection: { liquidCapital: 1, liquidCurrencyCode: 1 } }
  );
  const deleted = await corps.deleteOne({ _id: corporationId });
  if (!closing || (deleted?.deletedCount ?? 0) === 0) return;
  await witnessTreasuryCash(db, ledger, {
    flow: "corporation_liquidation",
    account: {
      kind: "corporation",
      corpId: corporationId.toString(),
      currency: snapshotCorporationCurrency(closing),
    },
    amount: -(closing.liquidCapital ?? 0),
    now,
    site,
  });
}
