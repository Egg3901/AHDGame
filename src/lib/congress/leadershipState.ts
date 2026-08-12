import type { Db, Filter, ObjectId } from "mongodb";
import { getPartyHex } from "@/lib/utils/politics";
import { getGameTime } from "@/lib/time/gameTime";
import { resolveLeadershipElection, isLeadershipElectionClosed } from "./leadershipElections";
import type {
  CongressLeader,
  Character,
  NPP,
  PoliticalParty,
  SenateLeadershipElection,
  HouseLeadershipElection,
  SenateLeadershipElectionRole,
  HouseLeadershipElectionRole,
  SenateLeadershipNomination,
  HouseLeadershipNomination,
  LeadershipRole,
} from "@/lib/db/types";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import {
  computeCongressLeadershipTally,
  type VoteByParty,
} from "@/lib/congress/governmentVoteBreakdown";

export interface LeaderDisplay {
  characterId: string;
  /** Sequential ID for stable URLs (prefer this over characterId) */
  sequentialId: number | null;
  characterName: string;
  avatarUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  party: string;
  partyName: string;
  partyColor: string;
  state?: string;
  electedAt: string | null;
  isNPP: boolean;
}

export interface CandidacyDisplay {
  id: string;
  nomineeId: string;
  nomineeName: string;
  nomineeParty: string;
  nomineePartyName: string;
  nomineePartyColor: string;
  nomineeState?: string;
  nominatedByName: string;
  avatarUrl?: string;
  borderKey?: string | null;
  tintColor?: string | null;
  status: string;
  votesFor: number;
  /** Party-level tally when any votes have been cast (same shape as bill votes). */
  voteByParty?: VoteByParty[];
  isMyVote: boolean;
  isMyCandidate: boolean;
}

export interface LeadershipElectionState {
  current: LeaderDisplay | null;
  candidacies: CandidacyDisplay[];
  election: {
    status: "voting" | "closed" | "cancelled" | "none";
    endsAt: string | null;
    endsOnTurn: number | null;
    startedAt: string | null;
  };
  partyLabel: string;
  partySeats: number;
  isMember: boolean;
  isInParty: boolean;
  hasActiveCandidacy: boolean;
  myVoteId: string | null;
  /** Nomination ID where the viewer's current vote was force-set by a Player Whip. */
  myWhippedFromVoteId: string | null;
  /** Pre-whip value: a previous candidacy ObjectId string or "unvoted". */
  myWhippedFromOriginal: string | null;
}

/**
 * Builds the complete state for a leadership position election.
 * Handles current leader enrichment, candidacy display, and user permissions.
 */
export async function buildLeadershipElectionState(
  db: Db,
  role: SenateLeadershipElectionRole | HouseLeadershipElectionRole,
  leaderRole: LeadershipRole,
  chamber: "senate" | "house",
  eligiblePartySlugs: Iterable<string> | null,
  partySeats: number,
  partyLabel: string,
  partyMap: Map<string, PoliticalParty>,
  myCharacterId: string | null,
  myParty: string | null,
  isMember: boolean
): Promise<LeadershipElectionState> {
  type ChamberNomination = SenateLeadershipNomination | HouseLeadershipNomination;
  const eligiblePartySet = new Set(eligiblePartySlugs ?? []);

  const electionCollection =
    chamber === "senate" ? "senateLeadershipElections" : "houseLeadershipElections";
  const nominationCollection =
    chamber === "senate" ? "senateLeadershipNominations" : "houseLeadershipNominations";

  // Fetch and possibly resolve election. Use the game clock so the endsAt
  // window matches turn-based resolution even when real time has drifted.
  let election = await db
    .collection<SenateLeadershipElection | HouseLeadershipElection>(electionCollection)
    .findOne({ _id: role });

  const gameTime = await getGameTime();
  const gameNow = gameTime.effectiveNow;
  if (
    election?.status === "voting" &&
    isLeadershipElectionClosed(election, gameTime.currentTurn, gameNow)
  ) {
    await resolveLeadershipElection(db, role, leaderRole, chamber, false);
    election = await db
      .collection<SenateLeadershipElection | HouseLeadershipElection>(electionCollection)
      .findOne({ _id: role });
  }

  const electionStatus = election?.status ?? "none";
  const isVoting =
    electionStatus === "voting" &&
    !!election &&
    !isLeadershipElectionClosed(election, gameTime.currentTurn, gameNow);

  // Fetch and enrich current leader
  const leaderDoc = await db
    .collection<CongressLeader>("congressLeaders")
    .findOne({ role: leaderRole });
  let current: LeaderDisplay | null = null;

  if (leaderDoc?.characterId) {
    const p = partyMap.get(leaderDoc.party ?? "");
    const char = await db
      .collection<Character>("characters")
      .findOne(
        { _id: leaderDoc.characterId },
        { projection: { avatarUrl: 1, homeState: 1, sequentialId: 1, userId: 1 } }
      );
    const npp = char
      ? null
      : await db
          .collection<NPP>("npps")
          .findOne(
            { _id: leaderDoc.characterId },
            { projection: { homeState: 1, avatarUrl: 1, sequentialId: 1 } }
          );
    const leaderBorder = char?.userId
      ? (await fetchBordersByUserIds(db, [char.userId])).get(char.userId.toString())
      : undefined;

    current = {
      characterId: leaderDoc.characterId.toString(),
      sequentialId: char?.sequentialId ?? npp?.sequentialId ?? null,
      characterName: leaderDoc.characterName,
      avatarUrl: char?.avatarUrl ?? npp?.avatarUrl,
      borderKey: leaderBorder?.borderKey ?? null,
      tintColor: leaderBorder?.tintColor ?? null,
      party: leaderDoc.party ?? "",
      partyName: p?.name ?? leaderDoc.party ?? "—",
      partyColor: getPartyHex(leaderDoc.party ?? "", p?.color),
      state: char?.homeState ?? npp?.homeState,
      electedAt: leaderDoc.electedAt?.toISOString() ?? null,
      isNPP: !char,
    };
  }

  const nominationFilter: Filter<ChamberNomination> = isVoting
    ? { role, status: { $in: ["open", "voting"] } }
    : { role, status: "confirmed" };

  // Fetch nominations
  const nomDocs = await db
    .collection<ChamberNomination>(nominationCollection)
    .find(nominationFilter)
    .sort({ votesFor: -1, createdAt: 1 })
    .toArray();

  // Enrich with avatars
  const nomineeIds = nomDocs.map((n: { nomineeId: ObjectId }) => n.nomineeId);
  const nomineeChars = await db
    .collection<Character>("characters")
    .find({ _id: { $in: nomineeIds } }, { projection: { _id: 1, avatarUrl: 1, userId: 1 } })
    .toArray();
  const avatarByNominee = new Map(nomineeChars.map((c) => [c._id.toString(), c.avatarUrl]));

  const nomBorderMap = await fetchBordersByUserIds(
    db,
    nomineeChars.map((c) => c.userId)
  );
  const borderByNominee = new Map(
    nomineeChars.map((c) => [c._id.toString(), nomBorderMap.get(c.userId.toString())])
  );

  // Fill NPP avatars
  const foundCharIds = new Set(nomineeChars.map((c) => c._id.toString()));
  const nppNomineeIds = nomineeIds.filter((id: ObjectId) => !foundCharIds.has(id.toString()));
  if (nppNomineeIds.length > 0) {
    const nppDocs = await db
      .collection<NPP>("npps")
      .find({ _id: { $in: nppNomineeIds } }, { projection: { _id: 1, avatarUrl: 1 } })
      .toArray();
    for (const npp of nppDocs) {
      avatarByNominee.set(npp._id.toString(), npp.avatarUrl);
    }
  }

  // Build candidacy displays (with party vote breakdown when ballots exist)
  const filteredNoms = nomDocs.filter((n: { status: string }) => n.status !== "confirmed");
  const candidacies: CandidacyDisplay[] = await Promise.all(
    filteredNoms.map(
      async (nom: {
        _id: ObjectId;
        nomineeId: ObjectId;
        nomineeName: string;
        nomineeParty?: string;
        nomineeState?: string;
        nominatedByName: string;
        status: string;
        votesFor: number;
        votes?: Record<string, "for" | "against">;
      }) => {
        const p = partyMap.get(nom.nomineeParty ?? "");
        // One source of truth: the seat-scoped seat-weighted count feeds
        // both the headline and the breakdown so they always agree.
        const tally = await computeCongressLeadershipTally(
          db,
          chamber === "senate" ? "senate" : "house",
          nom.votes
        );
        return {
          id: nom._id.toString(),
          nomineeId: nom.nomineeId.toString(),
          nomineeName: nom.nomineeName,
          nomineeParty: nom.nomineeParty ?? "",
          nomineePartyName: p?.name ?? nom.nomineeParty ?? "Independent",
          nomineePartyColor: getPartyHex(nom.nomineeParty ?? "", p?.color),
          nomineeState: nom.nomineeState,
          nominatedByName: nom.nominatedByName,
          avatarUrl: avatarByNominee.get(nom.nomineeId.toString()),
          borderKey: borderByNominee.get(nom.nomineeId.toString())?.borderKey ?? null,
          tintColor: borderByNominee.get(nom.nomineeId.toString())?.tintColor ?? null,
          status: nom.status,
          votesFor: tally.votesFor,
          voteByParty: tally.voteByParty.length > 0 ? tally.voteByParty : undefined,
          isMyVote: !!myCharacterId && !!nom.votes?.[myCharacterId],
          isMyCandidate: myCharacterId ? nom.nomineeId.toString() === myCharacterId : false,
        };
      }
    )
  );
  // Re-order by the recomputed count so the displayed leader matches the
  // headline numbers (the DB pre-sort used the cached counter).
  candidacies.sort((a, b) => b.votesFor - a.votesFor);

  // Compute user state
  let myVoteId: string | null = null;
  let myWhippedFromVoteId: string | null = null;
  let myWhippedFromOriginal: string | null = null;
  let hasActiveCandidacy = false;
  for (const nom of nomDocs) {
    const n = nom as {
      _id: ObjectId;
      nomineeId: ObjectId;
      votes?: Record<string, unknown>;
      whippedFromVote?: Record<string, string>;
    };
    if (myCharacterId && n.votes?.[myCharacterId]) myVoteId = n._id.toString();
    if (myCharacterId) {
      const wf = n.whippedFromVote?.[myCharacterId];
      if (wf) {
        myWhippedFromVoteId = n._id.toString();
        myWhippedFromOriginal = wf;
      }
    }
    if (myCharacterId && n.nomineeId.toString() === myCharacterId) hasActiveCandidacy = true;
  }

  const isInParty = myParty != null && eligiblePartySet.has(myParty);

  return {
    current,
    candidacies,
    election: {
      status: electionStatus,
      endsAt: election?.endsAt?.toISOString() ?? null,
      endsOnTurn: election?.endsOnTurn ?? null,
      startedAt: election?.startedAt?.toISOString() ?? null,
    },
    partyLabel,
    partySeats,
    isMember,
    isInParty,
    hasActiveCandidacy,
    myVoteId,
    myWhippedFromVoteId,
    myWhippedFromOriginal,
  };
}
