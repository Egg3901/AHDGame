import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";

export interface ReleaseCorporationHeldSharesResult {
  sharesReleased: number;
  corpsShareholderCleared: number;
}

/**
 * When a corporation exits the game, any cross-corporation equity positions it
 * still holds should be stripped from shareholder ledgers and returned to each
 * issuer's public float. We do this before deleting the holder corp so no
 * surviving corporation retains an orphaned `shareholders.corporationId`.
 */
export async function releaseCorporationHeldSharesToFloat(
  db: Db,
  holderCorporationId: ObjectId,
  now: Date = new Date()
): Promise<ReleaseCorporationHeldSharesResult> {
  const corps = db.collection<Corporation>("corporations");

  const held = await corps
    .find(
      { "shareholders.corporationId": holderCorporationId },
      { projection: { _id: 1, shareholders: 1 } }
    )
    .toArray();

  let sharesReleased = 0;
  let corpsShareholderCleared = 0;

  for (const corp of held) {
    const entry = corp.shareholders?.find(
      (shareholder) => shareholder.corporationId?.toString() === holderCorporationId.toString()
    );
    const shares = entry?.shares ?? 0;
    if (shares <= 0) continue;

    const res = await corps.updateOne(
      {
        _id: corp._id,
        shareholders: {
          $elemMatch: { corporationId: holderCorporationId, shares },
        },
      },
      {
        $pull: { shareholders: { corporationId: holderCorporationId } },
        $inc: { publicFloat: shares },
        $set: { updatedAt: now },
      }
    );

    if (res.modifiedCount === 1) {
      sharesReleased += shares;
      corpsShareholderCleared++;
    }
  }

  return { sharesReleased, corpsShareholderCleared };
}
