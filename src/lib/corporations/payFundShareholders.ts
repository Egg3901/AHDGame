import { ObjectId, type ClientSession, type Db, type UpdateFilter } from "mongodb";
import type { IndexFund } from "@/lib/db/types";
import type { FundShareholderPayoutRow } from "@/lib/bonds/corporateBondDefault";

/**
 * Pay index-fund shareholders their ₳ slice of a wound-down corporation's payout
 * pool, and drop each fund's now-stale holding of that (deleted) corp.
 *
 * Why (#3451): `allocateShareholderPool` counts fund shares in the denominator
 * but, before this, emitted no fund row — so a fund's slice was drained from the
 * payer yet distributed to no one (a conservation leak). This closes it for the
 * two flows that pay out a full shareholder pool and then delete the corp:
 * voluntary dissolution and nationalization's whole-corp payShareholders.
 *
 * Pool payouts are already ₳ and fund cash (`cashAnchor`) is ₳, so there is no
 * FX conversion. There is no `fund` subjectType for financialTxLog yet (the
 * Phase-3 ledger gap), so — like every other fund cash flow today — the credit
 * is the real, conserving move and the leg stays unbooked. Returns total ₳ paid.
 */
export async function payFundShareholderRows(
  db: Db,
  fundRows: FundShareholderPayoutRow[],
  dissolvedCorporationId: ObjectId,
  now: Date,
  options?: { session?: ClientSession }
): Promise<number> {
  let totalPaidAnchor = 0;
  for (const row of fundRows) {
    if (row.payout <= 0) continue;
    await db.collection<IndexFund>("indexFunds").updateOne(
      { _id: new ObjectId(row.fundId) },
      {
        $inc: { cashAnchor: row.payout },
        $pull: { holdings: { corporationId: dissolvedCorporationId } },
        $set: { updatedAt: now },
      } as unknown as UpdateFilter<IndexFund>,
      options?.session ? { session: options.session } : undefined
    );
    totalPaidAnchor += row.payout;
  }
  return totalPaidAnchor;
}
