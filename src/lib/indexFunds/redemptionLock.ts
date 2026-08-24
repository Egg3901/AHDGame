import { ObjectId, type Db } from "mongodb";
import type { IndexFund } from "@/lib/db/types";

const REDEMPTION_LOCK_TTL_MS = 20 * 60 * 1000;

/**
 * Serialize the standalone-Mongo redemption fallback for one fund. Transaction
 * capable deployments do not need this lock, but production currently uses the
 * sequential fallback.
 */
export async function claimFundRedemptionLock(
  db: Db,
  fundId: ObjectId,
  now = new Date()
): Promise<(() => Promise<void>) | null> {
  const token = new ObjectId();
  const expiresAt = new Date(now.getTime() + REDEMPTION_LOCK_TTL_MS);
  const claim = await db.collection<IndexFund>("indexFunds").updateOne(
    {
      _id: fundId,
      $or: [{ redemptionLock: { $exists: false } }, { "redemptionLock.expiresAt": { $lte: now } }],
    },
    {
      $set: {
        redemptionLock: { token, expiresAt },
        updatedAt: now,
      },
    }
  );
  if (claim.matchedCount === 0) return null;

  return async () => {
    await db
      .collection<IndexFund>("indexFunds")
      .updateOne(
        { _id: fundId, "redemptionLock.token": token },
        { $unset: { redemptionLock: "" }, $set: { updatedAt: new Date() } }
      );
  };
}
