/**
 * Client payload for the House vote panel: the vote window, the projected
 * delegations per candidate and, for a signed-in House member, their own choice.
 */
import type { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { ElectedOfficial, Election, ElectionVoteTally } from "@/lib/db/types";
import { CONTINGENT_EXCLUDED_HOUSE_STATE } from "@/lib/elections/contingentConstants";
import { loadHouseVoteStandings } from "@/lib/turn/election/contingentHouseVoteStandings";

export interface ContingentHouseVoteViewCandidate {
  id: string;
  name: string;
  /** State delegations currently backing this candidate. */
  delegations: number;
  /** House members (seat weighted) currently backing this candidate. */
  members: number;
}

export interface ContingentHouseVoteView {
  status: "open" | "closed";
  openedTurn: number;
  closesTurn: number;
  /** Turns until the window closes; 0 once it has. */
  turnsLeft: number;
  actingPresidentName: string;
  candidates: ContingentHouseVoteViewCandidate[];
  threshold: number;
  delegationsVoting: number;
  /** Set once the House elected a president. */
  winnerId: string | null;
  viewer: {
    /** Sits in the House with a delegation vote. */
    isHouseMember: boolean;
    /** Member and the vote is still open. */
    canVote: boolean;
    choiceId: string | null;
  };
}

export async function buildContingentHouseVoteView(
  db: Db,
  election: Pick<Election, "_id" | "countryId">,
  tally: ElectionVoteTally,
  currentTurn: number,
  viewerCharacterId: ObjectId | null
): Promise<ContingentHouseVoteView | null> {
  const vote = tally.contingentHouseVote;
  if (!vote) return null;

  const [standings, seat] = await Promise.all([
    loadHouseVoteStandings(db, election, tally, vote),
    viewerCharacterId
      ? db
          .collection<ElectedOfficial>("electedOfficials")
          .findOne(
            {
              countryId: election.countryId ?? "US",
              officeType: "house",
              characterId: viewerCharacterId,
            },
            { projection: { state: 1 } }
          )
      : Promise.resolve(null),
  ]);

  const isHouseMember = Boolean(seat && seat.state !== CONTINGENT_EXCLUDED_HOUSE_STATE);
  const open = vote.status === "open" && currentTurn < vote.closesTurn;
  const key = viewerCharacterId?.toString();
  return {
    status: vote.status,
    openedTurn: vote.openedTurn,
    closesTurn: vote.closesTurn,
    turnsLeft: Math.max(0, vote.closesTurn - currentTurn),
    actingPresidentName: vote.actingPresidentName,
    candidates: vote.eligibleCandidateIds.map((id) => ({
      id,
      name: tally.candidateNames?.[id] ?? id,
      delegations: standings.delegationTotals[id] ?? 0,
      members: standings.memberTotals[id] ?? 0,
    })),
    threshold: standings.threshold,
    delegationsVoting: standings.delegationsVoting,
    winnerId: vote.presidentWinnerId ?? null,
    viewer: {
      isHouseMember,
      canVote: isHouseMember && open,
      choiceId: key ? (vote.votes?.[key] ?? null) : null,
    },
  };
}
