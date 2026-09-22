import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

import type {
  Character,
  ElectionCandidate,
  ExecutiveEndorsement,
  NPP,
  StatePartyOrg,
} from "@/lib/db/types";
import type { NPPEndorsement } from "@/lib/db/types/nppInfluence";
import type { VoteTurnMemo } from "@/lib/electionEngine/tallyManagement";
import { buildActiveVisibleNppEndorsementFilter } from "@/lib/nppEndorsements";

export async function hydrateVoteTurnMemo(
  db: Db,
  memo: VoteTurnMemo,
  candidates: ElectionCandidate[],
  electionIds: ObjectId[]
): Promise<void> {
  const characterIds = [
    ...new Map(
      candidates
        .filter((candidate) => !candidate.isNPP && candidate.characterId)
        .map((candidate) => [candidate.characterId.toString(), candidate.characterId])
    ).values(),
  ];
  const nppIds = [
    ...new Map(
      candidates
        .filter((candidate) => candidate.isNPP && candidate.nppId)
        .map((candidate) => [candidate.nppId!.toString(), candidate.nppId!])
    ).values(),
  ];
  const candidateTargetIds = [
    ...new Map(
      candidates
        .filter((candidate) => candidate.characterId)
        .map((candidate) => [candidate.characterId.toString(), candidate.characterId])
    ).values(),
  ];

  const [characters, npps, statePartyChairRows, nppEndorsements, executiveEndorsements] =
    await Promise.all([
      characterIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: characterIds } })
            .toArray()
        : Promise.resolve([]),
      nppIds.length > 0
        ? db
            .collection<NPP>("npps")
            .find({ _id: { $in: nppIds } }, { projection: { "policies.domainPositions": 0 } })
            .toArray()
        : Promise.resolve([]),
      characterIds.length > 0
        ? db
            .collection<StatePartyOrg>("statePartyOrg")
            .find({ chairId: { $in: characterIds } }, { projection: { chairId: 1, stateId: 1 } })
            .toArray()
        : Promise.resolve([]),
      electionIds.length > 0 && candidateTargetIds.length > 0
        ? db
            .collection<NPPEndorsement>("nppEndorsements")
            .find(
              buildActiveVisibleNppEndorsementFilter({
                electionId: { $in: electionIds },
                candidateId: { $in: candidateTargetIds },
              })
            )
            .toArray()
        : Promise.resolve([]),
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

  const endorsementCountByKey = new Map<string, number>();
  for (const endorsement of nppEndorsements) {
    const key = `${endorsement.electionId}:${endorsement.candidateId}`;
    endorsementCountByKey.set(key, (endorsementCountByKey.get(key) ?? 0) + 1);
  }

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

  memo.candidatePreload = {
    charactersById: new Map(characters.map((character) => [character._id.toString(), character])),
    nppsById: new Map(npps.map((npp) => [npp._id.toString(), npp])),
    statePartyChairRows,
    endorsementCountByKey,
  };
  memo.executiveEndorsedCandidateIdsByElection = executiveByElection;
}
