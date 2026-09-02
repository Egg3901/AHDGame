import type { Db, ObjectId } from "mongodb";

/**
 * Remove a single character's pre-whip snapshot from a voting document.
 * Called from every character-facing vote-submission endpoint so the
 * "Whipped" badge disappears when the player picks a new vote.
 *
 * fieldName defaults to `"whippedFromVote"` but accepts alternates for
 * bills with per-chamber maps (otherChamberWhippedFromVote, vetoOverrideWhippedFromVote).
 */
export async function clearWhippedFromVote(
  db: Db,
  collectionName: string,
  // Singleton voting documents (the Speaker election, the motion to vacate) key
  // on the literal string "current" rather than an ObjectId.
  targetId: ObjectId | string,
  characterId: ObjectId,
  fieldName: string = "whippedFromVote"
): Promise<void> {
  await db
    .collection<{ _id: ObjectId | string }>(collectionName)
    .updateOne({ _id: targetId }, { $unset: { [`${fieldName}.${characterId.toString()}`]: "" } });
}
