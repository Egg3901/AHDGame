import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";

/**
 * Ordinal rank (1 = highest) for a character's national political influence within
 * their country. Uses `nationalInfluence` descending, then `_id` ascending as a
 * stable tie-break so exactly one ordering exists for tied scores.
 */
export async function getNationalNpiOrdinalRank(
  db: Db,
  character: Pick<Character, "_id" | "countryId" | "nationalInfluence">
): Promise<number> {
  const countryId = character.countryId ?? "US";
  const npi = character.nationalInfluence ?? 0;
  const ahead = await db.collection<Character>("characters").countDocuments({
    isBanned: { $ne: true },
    countryId,
    $or: [
      { nationalInfluence: { $gt: npi } },
      { nationalInfluence: npi, _id: { $lt: character._id } },
    ],
  });
  return ahead + 1;
}
