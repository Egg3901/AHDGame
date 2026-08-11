import { ObjectId, type Db } from "mongodb";
import type { Election, NPPEndorsement, NPP } from "@/lib/db/types";
import { buildActiveVisibleNppEndorsementFilter } from "@/lib/nppEndorsements";

export async function getNppEndorsements(db: Db, nppId: ObjectId) {
  const npp = await db.collection<NPP>("npps").findOne({ _id: nppId });
  if (!npp) return null;

  const endorsements = await db
    .collection<NPPEndorsement>("nppEndorsements")
    .find(buildActiveVisibleNppEndorsementFilter({ nppId }))
    .sort({ createdAt: -1 })
    .toArray();

  const elections =
    endorsements.length === 0
      ? []
      : await db
          .collection<Election>("elections")
          .find({ _id: { $in: endorsements.map((endorsement) => endorsement.electionId) } })
          .toArray();
  const electionMap = new Map(elections.map((election) => [election._id.toString(), election]));

  const formattedEndorsements = endorsements.map((endorsement) => {
    const election = electionMap.get(endorsement.electionId.toString());
    return {
      id: endorsement._id.toString(),
      candidateId: endorsement.candidateId.toString(),
      candidateName: endorsement.candidateName,
      candidateIsNPP: endorsement.candidateIsNPP,
      election: election
        ? {
            id: election._id.toString(),
            state: election.state,
            type: election.electionType,
            status: election.status,
            label: `${election.state} ${election.electionType}${
              election.electionType === "senate" ? ` (Class ${election.senateClass})` : ""
            }`,
          }
        : null,
      arrangedBy: endorsement.arrangedBy?.toString() || null,
      source: endorsement.source ?? "arranged",
      createdAt: endorsement.createdAt.toISOString(),
    };
  });

  return {
    npp: {
      id: npp._id.toString(),
      name: npp.name,
    },
    endorsements: formattedEndorsements,
    total: formattedEndorsements.length,
  };
}
