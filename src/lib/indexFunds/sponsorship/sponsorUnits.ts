import type { ClientSession, Db, ObjectId } from "mongodb";
import type { IndexFund } from "@/lib/db/types/indexFund";
import { sponsorUnitsLocked } from "./rules/accounting";

/** Shared capability for the account menu and the redemption mutation. */
export async function canRedeemSponsorUnits(
  db: Db,
  fund: IndexFund,
  corporationId: ObjectId,
  options?: { session?: ClientSession }
): Promise<boolean> {
  if (fund.seedAccounting !== "paid_units" || !fund.sponsorCorporationId?.equals(corporationId))
    return true;
  const otherHolders = await db.collection("indexFundPositions").countDocuments(
    {
      fundId: fund._id,
      units: { $gt: 0 },
      corporationId: { $ne: corporationId },
    },
    options
  );
  const pendingWithdrawals = await db.collection("indexFundRedemptionQueue").countDocuments(
    {
      fundId: fund._id,
      status: { $in: ["queued", "partial", "processing"] },
    },
    options
  );
  return !sponsorUnitsLocked({
    accounting: fund.seedAccounting,
    isSponsor: true,
    otherHolders,
    pendingWithdrawals,
  });
}
