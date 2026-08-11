import { ObjectId, type Db } from "mongodb";
import { type CountryId } from "@/lib/constants/countries";
import { getOrganizationProposalsCollection } from "@/lib/db/collections";
import { isVotingMember } from "@/lib/internationalOrganizations/orgMembership";
import { upsertPendingOrganizationVote } from "@/lib/internationalOrganizations/voteWrite";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

export async function voteMembershipProposal(params: {
  db: Db;
  countryId: CountryId;
  proposalId: string;
  actor: {
    characterId: ObjectId;
    characterName: string;
  };
  vote: "yes" | "no" | "abstain";
}) {
  const { db, countryId, proposalId, actor, vote } = params;
  if (!ObjectId.isValid(proposalId)) {
    return { ok: false as const, status: 400, error: "Invalid proposal id." };
  }
  const proposals = await getOrganizationProposalsCollection(db);
  const proposal = await proposals.findOne({ _id: new ObjectId(proposalId) });
  if (!proposal) {
    return { ok: false as const, status: 404, error: "Proposal not found" };
  }
  if (proposal.status !== "pending") {
    return { ok: false as const, status: 400, error: "Voting is closed on this proposal." };
  }
  if (proposal.proposingCountryId === countryId) {
    return {
      ok: false as const,
      status: 400,
      error: "A country may not vote on its own membership application.",
    };
  }
  if (!(await isVotingMember(db, proposal.organizationId, countryId))) {
    return {
      ok: false as const,
      status: 400,
      error: `${countryId} has no vote in ${proposal.organizationId}.`,
    };
  }

  const currentTurn = await getCurrentTurn(db);
  const newVote = {
    countryId,
    characterId: actor.characterId,
    characterName: actor.characterName,
    vote,
    castAt: new Date(),
    castOnTurn: currentTurn,
  };
  const updateResult = await upsertPendingOrganizationVote(proposals, proposal._id, newVote);
  if (updateResult.matchedCount === 0) {
    return { ok: false as const, status: 400, error: "Voting is closed on this proposal." };
  }

  return { ok: true as const };
}
