import type { Db, ObjectId } from "mongodb";

/**
 * Collections that denormalize an NPP's display name beside `nppId`.
 * Keep this list in sync with any new write path that copies `npp.name`.
 *
 * Ticket #1037: supporter NPP rename updated `npps.name` only, so election
 * polls kept showing the old name while search/management listed the new one.
 */
export async function syncDenormalizedNppName(
  db: Db,
  nppId: ObjectId,
  newName: string
): Promise<{ candidaciesUpdated: number; officialsUpdated: number }> {
  const [candidacies, officials] = await Promise.all([
    db.collection("electionCandidates").updateMany({ nppId }, { $set: { characterName: newName } }),
    db.collection("electedOfficials").updateMany({ nppId }, { $set: { characterName: newName } }),
  ]);

  return {
    candidaciesUpdated: candidacies.modifiedCount,
    officialsUpdated: officials.modifiedCount,
  };
}
