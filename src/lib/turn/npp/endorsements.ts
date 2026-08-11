import { ObjectId } from "mongodb";
import type { Election, ElectionCandidate, NPPEndorsement } from "@/lib/db/types";
import type { NPPContext } from "./context";
import {
  getEndorsementTargetId,
  nppCanPlausiblyEndorseElection,
  withdrawNppEndorsement,
} from "@/lib/nppEndorsements";

interface EndorsementSummary {
  created: number;
  switched: number;
  withdrawn: number;
  reevaluated: number;
}

export async function processNppEndorsements(ctx: NPPContext): Promise<EndorsementSummary> {
  const activeEndorsements = await ctx.db
    .collection<NPPEndorsement>("nppEndorsements")
    .find({ isActive: true })
    .toArray();

  if (activeEndorsements.length === 0) {
    return { created: 0, switched: 0, withdrawn: 0, reevaluated: 0 };
  }

  const electionIds = [
    ...new Set(activeEndorsements.map((endorsement) => endorsement.electionId.toString())),
  ].map((id) => new ObjectId(id));
  const [activeElections, activeCandidates] = await Promise.all([
    ctx.db
      .collection<Election>("elections")
      .find({ _id: { $in: electionIds }, status: "active" })
      .project<Election>({
        _id: 1,
        countryId: 1,
        electionType: 1,
        state: 1,
        senateClass: 1,
        chamberClass: 1,
        primaryEndTime: 1,
        endTime: 1,
        status: 1,
      })
      .toArray(),
    ctx.db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: { $in: electionIds }, status: "active" })
      .toArray(),
  ]);

  const electionsById = new Map(
    activeElections.map((election) => [election._id.toString(), election])
  );
  const candidateByElectionAndTarget = new Map<string, ElectionCandidate>();
  for (const candidate of activeCandidates) {
    candidateByElectionAndTarget.set(
      `${candidate.electionId.toString()}:${getEndorsementTargetId(candidate).toString()}`,
      candidate
    );
  }

  const summary: EndorsementSummary = {
    created: 0,
    switched: 0,
    withdrawn: 0,
    reevaluated: activeEndorsements.length,
  };

  for (const endorsement of activeEndorsements) {
    const npp = ctx.nppMap.get(endorsement.nppId.toString());
    const election = electionsById.get(endorsement.electionId.toString());
    const candidate = candidateByElectionAndTarget.get(
      `${endorsement.electionId.toString()}:${endorsement.candidateId.toString()}`
    );

    let withdrawalReason: NPPEndorsement["withdrawnReason"] | null = null;

    if ((endorsement.source ?? "organic") === "organic") {
      // Organic endorsements are disabled. Any remaining legacy rows should be
      // cleared on the next turn so active campaigns only keep endorsements
      // that a player explicitly requested for that race.
      withdrawalReason = "manual_only";
    } else if (!npp || !election) {
      withdrawalReason = !election ? "election_ended" : "relevance_lost";
    } else if (!candidate) {
      withdrawalReason = "candidate_inactive";
    } else if (!nppCanPlausiblyEndorseElection(npp, election)) {
      // Plausibility is now country-scoped — the only way an endorsement loses
      // it on reevaluation is if the NPP and election no longer share a country.
      withdrawalReason = "country_mismatch";
    }

    if (!withdrawalReason) continue;

    await withdrawNppEndorsement(ctx.db, endorsement._id, withdrawalReason, ctx.now);
    summary.withdrawn++;
  }

  return summary;
}
