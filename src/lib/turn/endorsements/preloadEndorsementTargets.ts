import type { Db, ObjectId } from "mongodb";
import type { Election, ElectionCandidate } from "@/lib/db/types";

/**
 * Shared preload for the two endorsement-withdrawal turn phases (#575).
 *
 * Both phases used to resolve their election and candidate one `findOne` at a
 * time, inside the loop over active endorsements — so a busy election cycle
 * holding hundreds of endorsements cost hundreds of serial round trips on the
 * turn hot path, latency-bound rather than compute-bound.
 *
 * Both phases read exactly one field off each row (`status`), so this projects
 * to it and returns plain status maps rather than documents. A missing key and
 * a non-active status collapse to the same decision at the call site, which is
 * what the original `!row || row.status !== "active"` did.
 */
export interface EndorsementTargetStatuses {
  /** electionId → status. Absent key means the election row does not exist. */
  electionStatus: Map<string, Election["status"]>;
  /** candidateId → status. Absent key means the candidate row does not exist. */
  candidateStatus: Map<string, ElectionCandidate["status"]>;
}

interface EndorsementTargetRefs {
  electionId: ObjectId;
  candidateId: ObjectId;
}

export async function preloadEndorsementTargets(
  db: Db,
  endorsements: ReadonlyArray<EndorsementTargetRefs>
): Promise<EndorsementTargetStatuses> {
  const electionStatus = new Map<string, Election["status"]>();
  const candidateStatus = new Map<string, ElectionCandidate["status"]>();
  if (endorsements.length === 0) return { electionStatus, candidateStatus };

  // Dedupe first: one leader endorsing twenty candidates in the same race is
  // the common shape, so the id sets are typically far smaller than the input.
  const electionIds = dedupe(endorsements.map((e) => e.electionId));
  const candidateIds = dedupe(endorsements.map((e) => e.candidateId));

  const [elections, candidates] = await Promise.all([
    db
      .collection<Election>("elections")
      .find({ _id: { $in: electionIds } }, { projection: { status: 1 } })
      .toArray(),
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ _id: { $in: candidateIds } }, { projection: { status: 1 } })
      .toArray(),
  ]);

  for (const row of elections) electionStatus.set(row._id.toString(), row.status);
  for (const row of candidates) candidateStatus.set(row._id.toString(), row.status);
  return { electionStatus, candidateStatus };
}

function dedupe(ids: ReadonlyArray<ObjectId>): ObjectId[] {
  const seen = new Map<string, ObjectId>();
  for (const id of ids) {
    const key = id?.toString();
    if (key && !seen.has(key)) seen.set(key, id);
  }
  return [...seen.values()];
}
