import type { Db, ObjectId } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  StatePartyCandidate,
  StatePartyElection,
} from "@/lib/db/types";

/**
 * Summarize the candidacies that a relocation will auto-withdraw.
 * Returned to the client so the confirmation dialog can warn the user.
 */
export async function getActiveCandidacySummary(
  db: Db,
  characterId: ObjectId
): Promise<{
  generalElections: number;
  statePartyElections: number;
}> {
  const generalRows = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ characterId, status: "active" })
    .project({ electionId: 1 })
    .toArray();

  let generalElections = 0;
  if (generalRows.length > 0) {
    const electionIds = [...new Set(generalRows.map((r) => r.electionId))];
    const openCount = await db.collection<Election>("elections").countDocuments({
      _id: { $in: electionIds },
      status: { $in: ["upcoming", "active", "completed"] },
    });
    generalElections = openCount;
  }

  const spRows = await db
    .collection<StatePartyCandidate>("statePartyCandidates")
    .find({ characterId, status: "active" })
    .project({ electionId: 1 })
    .toArray();

  let statePartyElections = 0;
  if (spRows.length > 0) {
    const electionIds = [...new Set(spRows.map((r) => r.electionId))];
    const openCount = await db
      .collection<StatePartyElection>("statePartyElections")
      .countDocuments({ _id: { $in: electionIds }, status: "voting" });
    statePartyElections = openCount;
  }

  return { generalElections, statePartyElections };
}
