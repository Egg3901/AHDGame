import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

import type { ElectionCandidate, ExecutiveEndorsement } from "@/lib/db/types";
import type { VoteTurnMemo } from "@/lib/electionEngine/tallyManagement";
import { loadCandidateEnrichmentPreload } from "@/lib/electionEngine/candidateEnrichment";

export async function hydrateVoteTurnMemo(
  db: Db,
  memo: VoteTurnMemo,
  candidates: ElectionCandidate[],
  electionIds: ObjectId[]
): Promise<void> {
  const [candidatePreload, executiveEndorsements] = await Promise.all([
    loadCandidateEnrichmentPreload(db, candidates, electionIds),
    electionIds.length > 0
      ? db
          .collection<ExecutiveEndorsement>("executiveEndorsements")
          .find({ electionId: { $in: electionIds }, isActive: true })
          .project<Pick<ExecutiveEndorsement, "electionId" | "candidateId">>({
            electionId: 1,
            candidateId: 1,
          })
          .toArray()
      : Promise.resolve([]),
  ]);

  // An empty set proves the sweep included this election and prevents a
  // per-election fallback query for races without active endorsements.
  const executiveByElection = new Map(
    electionIds.map((electionId) => [electionId.toString(), new Set<string>()])
  );
  for (const endorsement of executiveEndorsements) {
    const key = endorsement.electionId.toString();
    const ids = executiveByElection.get(key) ?? new Set<string>();
    ids.add(endorsement.candidateId.toString());
    executiveByElection.set(key, ids);
  }

  memo.candidatePreload = candidatePreload;
  memo.executiveEndorsedCandidateIdsByElection = executiveByElection;
}
