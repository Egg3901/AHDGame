/**
 * Client payload for the House vote panel: the vote window, each candidate's
 * delegations, the state grid, the whips in force, the ballot history and, for
 * a signed-in viewer, their own choice, their whip and the whips they can set.
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type {
  Character,
  Coalition,
  ElectedOfficial,
  Election,
  ElectionVoteTally,
  PoliticalParty,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { CONTINGENT_EXCLUDED_HOUSE_STATE } from "@/lib/elections/contingentConstants";
import { coalitionWhipKey, partyWhipKey } from "@/lib/elections/contingentHouseStandings";
import {
  loadHouseVoteStandings,
  loadPartyCoalitions,
} from "@/lib/turn/election/contingentHouseVoteStandings";

export interface ContingentHouseVoteViewCandidate {
  id: string;
  name: string;
  /** State delegations currently backing this candidate. */
  delegations: number;
  /** House members (seat weighted) currently backing this candidate; null once closed. */
  members: number | null;
  /** Withdrew, was deleted, or the holder died or retired: off the ballot. */
  dropped: boolean;
}

export interface ContingentHouseVoteViewWhip {
  key: string;
  scope: "party" | "coalition";
  /** Party or coalition name. */
  name: string;
  /** Candidacy id, or "free" for a free vote. */
  candidateId: string;
  setByName: string;
  turn: number;
}

export interface ContingentHouseVoteViewBallot {
  turn: number;
  /** The deadlocked ballot that opened the vote. */
  opening: boolean;
  totals: Record<string, number>;
  winnerId: string | null;
}

export interface ContingentHouseVoteViewDelegation {
  stateId: string;
  backing: string | null;
  tied: boolean;
}

export interface ContingentHouseVoteViewDefiance {
  name: string;
  stateId: string;
  candidateId: string;
  whipCandidateId: string;
}

export interface ContingentHouseVoteViewWhipControl {
  scope: "party" | "coalition";
  sequentialId: number;
  name: string;
  /** Current whip: candidacy id, "free", or null when none is set. */
  current: string | null;
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
  /** Current state of play while open, the final ballot once closed. */
  delegations: ContingentHouseVoteViewDelegation[];
  whips: ContingentHouseVoteViewWhip[];
  ballots: ContingentHouseVoteViewBallot[];
  /** Player members who voted against the whip that applies to them. */
  defiances: ContingentHouseVoteViewDefiance[];
  viewer: {
    /** Sits in the House with a delegation vote. */
    isHouseMember: boolean;
    /** Member and the vote is still open. */
    canVote: boolean;
    choiceId: string | null;
    /** The whip that applies to the viewer's party, if any. */
    whip: { name: string; scope: "party" | "coalition"; candidateId: string } | null;
    /** Whips the viewer chairs and may set while the vote is open. */
    canWhip: ContingentHouseVoteViewWhipControl[];
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
  const countryId = (election.countryId ?? "US") as CountryId;
  const open = vote.status === "open" && currentTurn < vote.closesTurn;
  const finalBallot = vote.ballots?.[vote.ballots.length - 1];

  const [standings, seat, viewer, parties, coalitions, partyCoalition] = await Promise.all([
    vote.status === "open" ? loadHouseVoteStandings(db, election, tally, vote) : null,
    viewerCharacterId
      ? db
          .collection<ElectedOfficial>("electedOfficials")
          .findOne(
            { countryId, officeType: "house", characterId: viewerCharacterId },
            { projection: { state: 1 } }
          )
      : Promise.resolve(null),
    viewerCharacterId
      ? db
          .collection<Character>("characters")
          .findOne({ _id: viewerCharacterId }, { projection: { party: 1 } })
      : Promise.resolve(null),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId })
      .project<Pick<PoliticalParty, "sequentialId" | "name" | "chairId">>({
        sequentialId: 1,
        name: 1,
        chairId: 1,
      })
      .toArray(),
    db
      .collection<Coalition>("coalitions")
      .find({ countryId })
      .project<Pick<Coalition, "sequentialId" | "name" | "chairCharacterId">>({
        sequentialId: 1,
        name: 1,
        chairCharacterId: 1,
      })
      .toArray(),
    loadPartyCoalitions(db, countryId),
  ]);

  const dropped = new Set(standings?.droppedCandidateIds ?? []);
  const totals = standings?.delegationTotals ?? finalBallot?.totals ?? {};
  const delegationVotes = standings?.delegationVotes ?? finalBallot?.delegationVotes ?? {};
  const delegations: ContingentHouseVoteViewDelegation[] = standings
    ? standings.delegations.map((d) => ({ stateId: d.stateId, backing: d.backing, tied: d.tied }))
    : Object.entries(delegationVotes)
        .filter(([stateId]) => stateId !== CONTINGENT_EXCLUDED_HOUSE_STATE)
        .map(([stateId, backing]) => ({ stateId, backing, tied: false }));

  const partyName = new Map(parties.map((p) => [String(p.sequentialId), p.name]));
  const coalitionName = new Map(coalitions.map((c) => [String(c.sequentialId), c.name]));
  const whips: ContingentHouseVoteViewWhip[] = Object.entries(vote.whips ?? {})
    .map(([key, w]) => {
      const [scope, id] = key.split(":") as ["party" | "coalition", string];
      const name = (scope === "party" ? partyName : coalitionName).get(id);
      return name
        ? { key, scope, name, candidateId: w.candidateId, setByName: w.setByName, turn: w.turn }
        : null;
    })
    .filter((w): w is ContingentHouseVoteViewWhip => w !== null)
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));

  const defianceChars = standings?.defiances.length
    ? await db
        .collection<Character>("characters")
        .find({ _id: { $in: standings.defiances.map((d) => new ObjectId(d.voterId)) } })
        .project<Pick<Character, "_id" | "name">>({ _id: 1, name: 1 })
        .toArray()
    : [];
  const defianceNames = new Map(defianceChars.map((c) => [c._id.toString(), c.name]));
  const defiances = (standings?.defiances ?? []).map((d) => ({
    name: defianceNames.get(d.voterId) ?? "A member",
    stateId: d.stateId,
    candidateId: d.candidateId,
    whipCandidateId: d.whipCandidateId,
  }));

  const opening: ContingentHouseVoteViewBallot[] = tally.contingentResult
    ? [
        {
          turn: vote.openedTurn,
          opening: true,
          totals: tally.contingentResult.houseVoteTotals ?? {},
          winnerId: null,
        },
      ]
    : [];
  const ballots = [
    ...opening,
    ...(vote.ballots ?? []).map((b) => ({
      turn: b.turn,
      opening: false,
      totals: b.totals,
      winnerId: b.winnerId,
    })),
  ];

  // The whip that applies to the viewer: their party's, else their coalition's.
  const viewerParty = viewer?.party ?? null;
  const applied = (() => {
    if (!viewerParty) return null;
    const party = vote.whips?.[partyWhipKey(viewerParty)];
    if (party) {
      return {
        name: partyName.get(viewerParty) ?? "Your party",
        scope: "party" as const,
        w: party,
      };
    }
    const coalitionId = partyCoalition[viewerParty];
    const coalition =
      coalitionId !== undefined ? vote.whips?.[coalitionWhipKey(coalitionId)] : null;
    return coalition
      ? {
          name: coalitionName.get(coalitionId) ?? "Your coalition",
          scope: "coalition" as const,
          w: coalition,
        }
      : null;
  })();

  const isHouseMember = Boolean(seat && seat.state !== CONTINGENT_EXCLUDED_HOUSE_STATE);
  const canWhip: ContingentHouseVoteViewWhipControl[] =
    open && viewerCharacterId
      ? [
          ...parties
            .filter((p) => p.chairId?.equals(viewerCharacterId))
            .map((p) => ({
              scope: "party" as const,
              sequentialId: p.sequentialId,
              name: p.name,
              current: vote.whips?.[partyWhipKey(p.sequentialId)]?.candidateId ?? null,
            })),
          ...coalitions
            .filter((c) => c.chairCharacterId?.equals(viewerCharacterId))
            .map((c) => ({
              scope: "coalition" as const,
              sequentialId: c.sequentialId,
              name: c.name,
              current: vote.whips?.[coalitionWhipKey(c.sequentialId)]?.candidateId ?? null,
            })),
        ]
      : [];

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
      delegations: totals[id] ?? 0,
      members: standings ? (standings.memberTotals[id] ?? 0) : null,
      dropped: dropped.has(id),
    })),
    threshold: standings?.threshold ?? tally.contingentResult?.houseThreshold ?? 26,
    delegationsVoting: Object.values(delegationVotes).filter(Boolean).length,
    winnerId: vote.presidentWinnerId ?? null,
    delegations,
    whips,
    ballots,
    defiances,
    viewer: {
      isHouseMember,
      canVote: isHouseMember && open,
      choiceId: key ? (vote.votes?.[key] ?? null) : null,
      whip: applied
        ? { name: applied.name, scope: applied.scope, candidateId: applied.w.candidateId }
        : null,
      canWhip,
    },
  };
}
