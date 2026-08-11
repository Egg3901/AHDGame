import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";

export interface ReleaseCharacterHeldSharesResult {
  sharesReleased: number;
  positionsReleased: number;
}

/**
 * Remove direct personal shareholder rows before a character exits the game so
 * issuer ledgers do not retain orphaned `characterId` references.
 *
 * `opts.excludeCorporationIds` keeps the listed issuers' positions untouched —
 * used by the inactive-user sweep to spare corps the holder owns / is CEO of.
 */
export async function releaseCharacterHeldSharesToFloat(
  db: Db,
  characterIds: ObjectId[],
  now: Date = new Date(),
  opts?: { excludeCorporationIds?: ObjectId[] }
): Promise<ReleaseCharacterHeldSharesResult> {
  if (characterIds.length === 0) {
    return { sharesReleased: 0, positionsReleased: 0 };
  }

  const exclude = opts?.excludeCorporationIds ?? [];
  const excludeSet = new Set(exclude.map((id) => id.toString()));

  const query: Record<string, unknown> = {
    "shareholders.characterId": { $in: characterIds },
  };
  if (exclude.length > 0) {
    query._id = { $nin: exclude };
  }

  const corps = await db
    .collection<Corporation>("corporations")
    .find(query, { projection: { _id: 1, shareholders: 1 } })
    .toArray();

  const charIdSet = new Set(characterIds.map((id) => id.toString()));
  let sharesReleased = 0;
  let positionsReleased = 0;

  for (const corp of corps) {
    if (excludeSet.has(corp._id.toString())) continue;

    const entries = (corp.shareholders ?? []).filter((shareholder) =>
      shareholder.characterId ? charIdSet.has(shareholder.characterId.toString()) : false
    );

    for (const entry of entries) {
      const characterId = entry.characterId;
      const shares = entry.shares ?? 0;
      if (!characterId || shares <= 0) continue;

      const res = await db.collection<Corporation>("corporations").updateOne(
        {
          _id: corp._id,
          shareholders: { $elemMatch: { characterId, shares } },
        },
        {
          $pull: { shareholders: { characterId } },
          $inc: { publicFloat: shares },
          $set: { updatedAt: now },
        }
      );

      if (res.modifiedCount === 1) {
        sharesReleased += shares;
        positionsReleased += 1;
      }
    }
  }

  return { sharesReleased, positionsReleased };
}
