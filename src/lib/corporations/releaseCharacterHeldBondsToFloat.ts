import type { Db, ObjectId } from "mongodb";
import type { Bond } from "@/lib/db/types";

export interface ReleaseCharacterHeldBondsResult {
  unitsReleased: number;
  bondsCleared: number;
}

/**
 * Remove direct bond-holder rows before a character exits the game so issuer
 * ledgers do not retain orphaned `characterId` references — the bond analogue
 * of {@link releaseCharacterHeldSharesToFloat}, itself mirroring
 * {@link releaseCorporationHeldBondsToFloat}'s CAS-on-exact-units pattern.
 *
 * Without this, a retiring/deleted character's bond units are never released:
 * the issuer keeps `totalIssued` on its books (real debt drawn down at
 * issuance) with units pointing at a holder that no longer exists — coupons
 * still accrue against them but nothing can ever redeem or trade them.
 */
export async function releaseCharacterHeldBondsToFloat(
  db: Db,
  characterIds: ObjectId[],
  now: Date = new Date()
): Promise<ReleaseCharacterHeldBondsResult> {
  if (characterIds.length === 0) {
    return { unitsReleased: 0, bondsCleared: 0 };
  }

  const bonds = db.collection<Bond>("bonds");
  const charIdSet = new Set(characterIds.map((id) => id.toString()));

  const held = await bonds
    .find({ "holders.characterId": { $in: characterIds } }, { projection: { _id: 1, holders: 1 } })
    .toArray();

  let unitsReleased = 0;
  let bondsCleared = 0;

  for (const bond of held) {
    const entries = (bond.holders ?? []).filter((holder) =>
      holder.characterId ? charIdSet.has(holder.characterId.toString()) : false
    );

    for (const entry of entries) {
      const characterId = entry.characterId;
      const units = entry.units ?? 0;
      if (!characterId) continue;

      // CAS on the exact unit count (mirrors releaseCorporationHeldBondsToFloat):
      // if a concurrent coupon/maturity/trade turn changed this holder's units
      // between the read above and the write, the filter no longer matches and
      // we skip rather than $inc publicFloat by a stale value. A zero-unit
      // holder entry is still a stale reference worth scrubbing; only the
      // publicFloat $inc is gated on a positive unit count.
      const res = await bonds.updateOne(
        {
          _id: bond._id,
          holders: { $elemMatch: { characterId, units } },
        },
        {
          $pull: { holders: { characterId } },
          ...(units > 0 ? { $inc: { publicFloat: units } } : {}),
          $set: { updatedAt: now },
        }
      );

      if (res.modifiedCount === 1) {
        unitsReleased += units;
        bondsCleared += 1;
      }
    }
  }

  return { unitsReleased, bondsCleared };
}
