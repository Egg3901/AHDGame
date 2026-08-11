import type { Db, ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types";

export interface ReleaseCorporationHeldBondsResult {
  unitsReleased: number;
  bondsCleared: number;
}

/**
 * When a corporation exits the game (dissolution, hostile-takeover absorption,
 * shell re-absorption), any corporate bonds it still HOLDS as a creditor must
 * have those units returned to the issuer's public float — otherwise the units
 * are orphaned: the issuer keeps `totalIssued` on its books (real debt it drew
 * down at issuance) but has zero outstanding units, so coupons stop and nothing
 * settles at maturity (the "bonds disappeared / ownership empty" symptom).
 *
 * This is the bond analogue of {@link releaseCorporationHeldSharesToFloat}: the
 * issuer's debt stays real and live (it resumes paying coupons to float and
 * repays at maturity), and no corp is left with a holder entry pointing at a
 * deleted corporation.
 *
 * Callers that separately settle the held bonds at face value into the exiting
 * corp's liquidCapital (the two dissolution paths) should NOT use this helper —
 * they fold the `publicFloat` return into their own settlement loop so the
 * face-value credit and the float return stay in one pass. Use this for
 * deletion paths that strip holdings without a creditor payout (takeover
 * absorption, shell re-absorption).
 */
export async function releaseCorporationHeldBondsToFloat(
  db: Db,
  holderCorporationId: ObjectId,
  now: Date = new Date()
): Promise<ReleaseCorporationHeldBondsResult> {
  const bonds = db.collection<Bond>("bonds");

  const held = await bonds
    .find({ "holders.corporationId": holderCorporationId }, { projection: { _id: 1, holders: 1 } })
    .toArray();

  let unitsReleased = 0;
  let bondsCleared = 0;

  for (const bond of held) {
    const entry = bond.holders?.find(
      (holder) => holder.corporationId?.toString() === holderCorporationId.toString()
    );
    const units = entry?.units ?? 0;

    // CAS on the exact unit count (mirrors releaseCorporationHeldSharesToFloat):
    // if a concurrent coupon/maturity/trade turn changed this holder's units
    // between the read above and the write, the filter no longer matches and we
    // skip rather than $inc publicFloat by a stale value. A zero-unit holder
    // entry is still a stale reference worth scrubbing; only the publicFloat
    // $inc is gated on a positive unit count.
    const res = await bonds.updateOne(
      {
        _id: bond._id,
        holders: { $elemMatch: { corporationId: holderCorporationId, units } },
      },
      {
        $pull: { holders: { corporationId: holderCorporationId } },
        ...(units > 0 ? { $inc: { publicFloat: units } } : {}),
        $set: { updatedAt: now },
      }
    );

    if (res.modifiedCount === 1) {
      unitsReleased += units;
      bondsCleared++;
    }
  }

  return { unitsReleased, bondsCleared };
}
