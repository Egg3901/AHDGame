import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import { wouldCreateOwnershipCycle } from "./helpers";

/** Refusal message shown when a corporate purchase would close an ownership loop. */
export const OWNERSHIP_CYCLE_ERROR =
  "That corporation already controls yours, directly or through a chain of subsidiaries. Buying its shares would create a circular ownership loop.";

/**
 * Would `buyer` buying into `target` close an ownership loop (A controls B
 * controls A)?
 *
 * `wouldCreateOwnershipCycle` has existed since the subsidiary work landed but
 * had exactly one call site, `formalizeSubsidiary`. Formalizing is the LAST step
 * of becoming a parent, not the first: a corp could buy its way to majority
 * control of the corp that already controls it and only be stopped when it tried
 * to formalize, by which point the loop already existed in the share graph and
 * every derived-control read had to cope with it.
 *
 * Checked at the point of purchase instead, so the loop never forms. Reads the
 * corp graph once; callers should only invoke it on the corporate-buyer path.
 */
export async function corpPurchaseWouldCycle(
  db: Db,
  buyerCorpId: ObjectId,
  targetCorpId: ObjectId
): Promise<boolean> {
  if (buyerCorpId.equals(targetCorpId)) return true;

  const allCorps = await db
    .collection<Corporation>("corporations")
    .find({}, { projection: { _id: 1, shareholders: 1, totalShares: 1, superShareMultiplier: 1 } })
    .toArray();

  return wouldCreateOwnershipCycle({ _id: buyerCorpId }, { _id: targetCorpId }, allCorps);
}
