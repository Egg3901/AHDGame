import { ObjectId, type Db } from "mongodb";
import { getAuthUserWithCharacter, type AuthUserWithCharacter } from "@/lib/auth";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import { getPartyTenure } from "@/lib/parties/leadershipTenure";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { getEligibleVoterSet } from "@/lib/parties/proposals";
import {
  COMMITTEE_ELECTION_DURATION_TURNS,
  COMMITTEE_SIZE,
} from "@/lib/nationalCommitteeElections";
import { NATIONAL_ALL_POSITIONS } from "@/lib/nationalPartyElections";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { getBannedCharacterIds } from "@/lib/utils/bannedCharacters";
import type {
  Character,
  NationalCommitteeCandidate,
  NationalCommitteeElection,
  NationalCommitteeVote,
  NationalPartyCandidate,
  NationalPartyElection,
  NationalPartyElectionPosition,
  NationalPartyVote,
  PoliticalParty,
} from "@/lib/db/types";
import type {
  CommitteeData,
  CommitteeElection,
  NationalElectionsState,
} from "@/lib/parties/dto/partyView";

async function getOptionalViewer(): Promise<AuthUserWithCharacter | null> {
  try {
    return await getAuthUserWithCharacter();
  } catch {
    return null;
  }
}

export async function getNationalPartyElectionState(
  db: Db,
  party: PoliticalParty
): Promise<NationalElectionsState> {
  const authUser = await getOptionalViewer();
  const partyId = String(party.sequentialId);
  const partyCountryId = party.countryId ?? "US";
  const isMember =
    authUser?.character?.party === partyId && authUser?.character?.countryId === partyCountryId;
  const activeElections = await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .find({
      partyId,
      countryId: partyCountryId,
      position: { $in: NATIONAL_ALL_POSITIONS },
      status: "voting",
    })
    .toArray();
  // Founding elections (the accelerated 12-turn chair race at iteration start)
  // waive the 24h new-character cooldown and the party-tenure gate — the
  // enter/vote routes enforce the same waiver server-side.
  const hasFoundingElection = activeElections.some((election) => election.founding === true);

  // `canRun` retains the membership + committee-method eligibility gate but
  // intentionally NOT the 24h new-character cooldown — that's surfaced via
  // `runCooldownUntil` instead, so the panel can render a disabled Run button
  // with a countdown rather than hide it silently. `canVote` keeps the
  // cooldown gate to preserve the existing "no votes during cooldown" UX
  // (the vote routes enforce the cooldown server-side too).
  let canRun = !!isMember;
  let canVote = !!isMember;
  let runCooldownUntil: string | null = null;
  if (isMember && authUser?.character && !hasFoundingElection) {
    if (party.leadershipElectionMethod === "committee") {
      const eligible = getEligibleVoterSet(party);
      if (!eligible.has(authUser.character._id.toString())) {
        canRun = false;
        canVote = false;
      }
    }
    if (canRun) {
      const userDoc = await db
        .collection("users")
        .findOne({ _id: new ObjectId(authUser.userId) }, { projection: { createdAt: 1 } });
      const cooldown = isInNewCharacterCooldown({
        userCreatedAt: (userDoc?.createdAt as Date | undefined) ?? new Date(0),
        characterCreatedAt: authUser.character.createdAt,
        partyJoinedAt: authUser.character.partyJoinedAt,
        includePartyJoinedAt: false,
      });
      if (cooldown.blocked) {
        runCooldownUntil = cooldown.unblockAt.toISOString();
        canVote = false;
      }
      // Turn-based party-tenure gate (leadershipTenure.ts). Like the
      // committee-method ineligibility above, an under-tenured member is
      // disabled from both running and voting (the enter/vote routes enforce
      // this server-side too). Pre-disabling avoids a click-then-403.
      const currentTurn = await getCurrentTurn(db);
      if (!getPartyTenure(authUser.character.partyJoinedTurn, currentTurn).eligible) {
        canRun = false;
        canVote = false;
      }
    }
  } else if (isMember && authUser?.character && party.leadershipElectionMethod === "committee") {
    // Committee-method restriction still applies during founding elections.
    const eligible = getEligibleVoterSet(party);
    if (!eligible.has(authUser.character._id.toString())) {
      canRun = false;
      canVote = false;
    }
  }

  const holderMap: Record<NationalPartyElectionPosition, string | null> = {
    chair: party.chairId?.toString() ?? null,
    viceChair: party.viceChairId?.toString() ?? null,
    treasurer: party.treasurerId?.toString() ?? null,
  };

  const activePositions = new Set(activeElections.map((election) => election.position));
  const missingPositions = NATIONAL_ALL_POSITIONS.filter(
    (position) => !activePositions.has(position)
  );

  const completedElections =
    missingPositions.length === 0
      ? []
      : await db
          .collection<NationalPartyElection>("nationalPartyElections")
          .aggregate<NationalPartyElection>([
            {
              $match: {
                partyId,
                countryId: partyCountryId,
                position: { $in: missingPositions },
                status: { $in: ["completed", "cancelled"] },
              },
            },
            { $sort: { endTime: -1 } },
            { $group: { _id: "$position", doc: { $first: "$$ROOT" } } },
            { $replaceRoot: { newRoot: "$doc" } },
          ])
          .toArray();

  const electionByPosition = new Map<NationalPartyElectionPosition, NationalPartyElection>();
  for (const election of [...activeElections, ...completedElections]) {
    electionByPosition.set(election.position, election);
  }

  const electionIds = [...electionByPosition.values()].map((election) => election._id);
  if (electionIds.length === 0) {
    return {
      elections: { chair: null, viceChair: null, treasurer: null },
      currentHolders: holderMap,
      canVote,
      canRun,
      runCooldownUntil,
      userVotes: { chair: null, viceChair: null, treasurer: null },
      isCandidate: { chair: false, viceChair: false, treasurer: false },
      leadershipElectionMethod: party.leadershipElectionMethod,
    };
  }

  const activeElectionIds = activeElections.map((election) => election._id);
  const bannedCharacterIds = await getBannedCharacterIds(db);
  const voteMatch: Record<string, unknown> = { electionId: { $in: electionIds } };
  const bannedVoterObjectIds = [...bannedCharacterIds].map((id) => new ObjectId(id));
  if (bannedVoterObjectIds.length > 0) {
    voteMatch.voterId = { $nin: bannedVoterObjectIds };
  }

  const [allCandidatesRaw, allVoteCounts, allUserVotes] = await Promise.all([
    db
      .collection<NationalPartyCandidate>("nationalPartyCandidates")
      // electionIds spans active (voting) AND most-recent completed elections for
      // missing positions. Resolved elections terminalize candidacies to
      // "completed", so include those (and "active") while excluding player
      // withdrawals — otherwise concluded-race results render with no candidates.
      .find({ electionId: { $in: electionIds }, status: { $ne: "withdrawn" } })
      .toArray(),
    db
      .collection<NationalPartyVote>("nationalPartyVotes")
      .aggregate<{
        electionId: ObjectId;
        candidateId: ObjectId;
        count: number;
        partyInfluenceSum: number;
      }>([
        { $match: voteMatch },
        {
          $group: {
            _id: { electionId: "$electionId", candidateId: "$candidateId" },
            count: { $sum: 1 },
            partyInfluenceSum: { $sum: { $ifNull: ["$voterPartyInfluence", 0] } },
          },
        },
        {
          $project: {
            _id: 0,
            electionId: "$_id.electionId",
            candidateId: "$_id.candidateId",
            count: 1,
            partyInfluenceSum: 1,
          },
        },
      ])
      .toArray(),
    authUser?.character && activeElectionIds.length > 0
      ? db
          .collection<NationalPartyVote>("nationalPartyVotes")
          .find({ electionId: { $in: activeElectionIds }, voterId: authUser.character._id })
          .toArray()
      : Promise.resolve([] as NationalPartyVote[]),
  ]);

  const allCandidates = allCandidatesRaw.filter(
    (candidate) => !bannedCharacterIds.has(candidate.characterId.toString())
  );
  const candidateCharacterIds = [
    ...new Set(allCandidates.map((candidate) => candidate.characterId)),
  ];
  const candidateCharacters =
    candidateCharacterIds.length === 0
      ? []
      : await db
          .collection<Character>("characters")
          .find(
            { _id: { $in: candidateCharacterIds } },
            { projection: { _id: 1, sequentialId: 1 } }
          )
          .toArray();
  const charSequentialIdMap = new Map(
    candidateCharacters.map((character) => [character._id.toString(), character.sequentialId])
  );

  const candidatesByElection = new Map<string, NationalPartyCandidate[]>();
  for (const candidate of allCandidates) {
    const key = candidate.electionId.toString();
    const list = candidatesByElection.get(key) ?? [];
    list.push(candidate);
    candidatesByElection.set(key, list);
  }

  const activeCharIdsByElection = new Map<string, Set<string>>();
  for (const candidate of allCandidates) {
    const electionId = candidate.electionId.toString();
    const activeCandidateIds = activeCharIdsByElection.get(electionId) ?? new Set<string>();
    activeCandidateIds.add(candidate.characterId.toString());
    activeCharIdsByElection.set(electionId, activeCandidateIds);
  }

  const useInfluence = party.leadershipElectionMethod === "influence";
  const voteCountMap = new Map<string, Map<string, number>>();
  const totalVotesByElection = new Map<string, number>();
  for (const vote of allVoteCounts) {
    const electionId = vote.electionId.toString();
    const candidateId = vote.candidateId.toString();
    if (!activeCharIdsByElection.get(electionId)?.has(candidateId)) continue;
    const score = useInfluence ? vote.partyInfluenceSum : vote.count;
    const electionVotes = voteCountMap.get(electionId) ?? new Map<string, number>();
    electionVotes.set(candidateId, score);
    voteCountMap.set(electionId, electionVotes);
    totalVotesByElection.set(electionId, (totalVotesByElection.get(electionId) ?? 0) + score);
  }

  const userVoteByElection = new Map(
    allUserVotes.map((vote) => [vote.electionId.toString(), vote] as const)
  );

  const elections: NationalElectionsState["elections"] = {
    chair: null,
    viceChair: null,
    treasurer: null,
  };
  const userVotes: NationalElectionsState["userVotes"] = {
    chair: null,
    viceChair: null,
    treasurer: null,
  };
  const isCandidate: NationalElectionsState["isCandidate"] = {
    chair: false,
    viceChair: false,
    treasurer: false,
  };

  for (const position of NATIONAL_ALL_POSITIONS) {
    const election = electionByPosition.get(position);
    if (!election) continue;

    const electionId = election._id.toString();
    const candidates = candidatesByElection.get(electionId) ?? [];
    const electionVoteMap = voteCountMap.get(electionId) ?? new Map<string, number>();
    const totalVotes = totalVotesByElection.get(electionId) ?? 0;
    const candidateDisplay = candidates
      .map((candidate) => ({
        id: candidate._id.toString(),
        characterId: candidate.characterId.toString(),
        characterName: candidate.characterName,
        voteCount: electionVoteMap.get(candidate.characterId.toString()) ?? 0,
        isCurrentHolder: candidate.characterId.toString() === holderMap[position],
        sequentialId: charSequentialIdMap.get(candidate.characterId.toString()),
      }))
      .sort((left, right) => right.voteCount - left.voteCount || left.id.localeCompare(right.id));

    const winnerName = election.winnerId
      ? (candidates.find((candidate) => candidate.characterId.equals(election.winnerId))
          ?.characterName ?? null)
      : null;

    elections[position] = {
      id: electionId,
      position,
      positionLabel: getPartyRoleLabel(partyCountryId, position),
      status: election.status,
      startTime: election.startTime.toISOString(),
      endTime: election.endTime.toISOString(),
      startTurn: election.startTurn,
      endTurn: election.endTurn,
      durationTurns: election.durationTurns,
      candidates: candidateDisplay,
      totalVotes,
      winnerId: election.winnerId?.toString() ?? null,
      winnerName,
    };

    if (authUser?.character && election.status === "voting") {
      const vote = userVoteByElection.get(electionId);
      if (vote) {
        const votedCandidate = candidates.find((candidate) =>
          candidate.characterId.equals(vote.candidateId)
        );
        userVotes[position] = {
          candidateId: vote.candidateId.toString(),
          candidateName: votedCandidate?.characterName ?? "Unknown",
        };
      }
      isCandidate[position] = candidates.some((candidate) =>
        candidate.characterId.equals(authUser.character!._id)
      );
    }
  }

  return {
    elections,
    currentHolders: holderMap,
    canVote,
    canRun,
    runCooldownUntil,
    userVotes,
    isCandidate,
    leadershipElectionMethod: party.leadershipElectionMethod,
  };
}

export async function getNationalCommitteeState(
  db: Db,
  party: PoliticalParty
): Promise<CommitteeData> {
  const authUser = await getOptionalViewer();
  const partyId = String(party.sequentialId);
  const partyCountryId = party.countryId ?? "US";
  const isMember =
    authUser?.character?.party === partyId && authUser?.character?.countryId === partyCountryId;
  const bannedCharacterIds = await getBannedCharacterIds(db);

  // Committee path uses the default `includePartyJoinedAt: true`, matching
  // the cooldown gate in the committee/enter route.
  let runCooldownUntil: string | null = null;
  if (isMember && authUser?.character) {
    const userDoc = await db
      .collection("users")
      .findOne({ _id: new ObjectId(authUser.userId) }, { projection: { createdAt: 1 } });
    const cooldown = isInNewCharacterCooldown({
      userCreatedAt: (userDoc?.createdAt as Date | undefined) ?? new Date(0),
      characterCreatedAt: authUser.character.createdAt,
      partyJoinedAt: authUser.character.partyJoinedAt,
    });
    if (cooldown.blocked) {
      runCooldownUntil = cooldown.unblockAt.toISOString();
    }
  }

  const committeeIds = party.committeeIds || [];
  const committeeMembers =
    committeeIds.length === 0
      ? []
      : (
          await db
            .collection<Character>("characters")
            .find({ _id: { $in: committeeIds } })
            .toArray()
        )
          .filter((member) => !bannedCharacterIds.has(member._id.toString()))
          .sort(
            (left, right) =>
              committeeIds.findIndex((id) => id.equals(left._id)) -
              committeeIds.findIndex((id) => id.equals(right._id))
          )
          .map((member) => ({
            id: member.sequentialId?.toString() ?? member._id.toString(),
            sequentialId: member.sequentialId,
            name: member.name,
          }));

  const election =
    (await db
      .collection<NationalCommitteeElection>("nationalCommitteeElections")
      .findOne({ partyId, countryId: partyCountryId, status: "voting" })) ??
    (await db
      .collection<NationalCommitteeElection>("nationalCommitteeElections")
      .findOne(
        { partyId, countryId: partyCountryId, status: { $in: ["completed", "cancelled"] } },
        { sort: { endTime: -1 } }
      ));

  let electionDisplay: CommitteeElection | null = null;
  let userVotes: string[] = [];
  let isCandidate = false;

  if (election) {
    const candidatesRaw = await db
      .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
      // `election` may be the most-recent completed/cancelled one (display
      // fallback). Resolved elections terminalize candidacies to "completed",
      // so include those (and "active") while excluding player withdrawals.
      .find({ electionId: election._id, status: { $ne: "withdrawn" } })
      .toArray();
    const candidates = candidatesRaw.filter(
      (candidate) => !bannedCharacterIds.has(candidate.characterId.toString())
    );

    const candidateCharacters =
      candidates.length === 0
        ? []
        : await db
            .collection<Character>("characters")
            .find(
              { _id: { $in: [...new Set(candidates.map((candidate) => candidate.characterId))] } },
              { projection: { _id: 1, sequentialId: 1 } }
            )
            .toArray();
    const charSequentialIdMap = new Map(
      candidateCharacters.map((character) => [character._id.toString(), character.sequentialId])
    );

    const votesRaw = await db
      .collection<NationalCommitteeVote>("nationalCommitteeVotes")
      .find({ electionId: election._id })
      .toArray();
    const votes = votesRaw.filter((vote) => !bannedCharacterIds.has(vote.voterId.toString()));
    const activeCandidateIds = new Set(
      candidates.map((candidate) => candidate.characterId.toString())
    );
    const voteCountMap = new Map<string, number>();
    for (const vote of votes) {
      for (const candidateId of vote.candidateIds) {
        const key = candidateId.toString();
        if (!activeCandidateIds.has(key)) continue;
        voteCountMap.set(key, (voteCountMap.get(key) ?? 0) + 1);
      }
    }

    const candidateDisplay = candidates
      .map((candidate) => ({
        id: candidate._id.toString(),
        characterId: candidate.characterId.toString(),
        sequentialId: charSequentialIdMap.get(candidate.characterId.toString()),
        characterName: candidate.characterName,
        voteCount: voteCountMap.get(candidate.characterId.toString()) ?? 0,
        isCurrentCommittee: committeeIds.some((id) => id.equals(candidate.characterId)),
      }))
      .sort((left, right) => right.voteCount - left.voteCount || left.id.localeCompare(right.id));

    electionDisplay = {
      id: election._id.toString(),
      status: election.status,
      startTime: election.startTime.toISOString(),
      endTime: election.endTime.toISOString(),
      startTurn: election.startTurn,
      endTurn: election.endTurn,
      durationTurns: election.durationTurns,
      candidates: candidateDisplay,
      totalVoters: votes.length,
      winnerIds: election.winnerIds.map((id) => id.toString()),
    };

    if (authUser?.character && election.status === "voting") {
      const userVote = await db
        .collection<NationalCommitteeVote>("nationalCommitteeVotes")
        .findOne({ electionId: election._id, voterId: authUser.character._id });
      if (userVote) {
        userVotes = userVote.candidateIds
          .map((candidateId) => candidateId.toString())
          .filter((candidateId) => activeCandidateIds.has(candidateId));
      }
      isCandidate = candidates.some((candidate) =>
        candidate.characterId.equals(authUser.character!._id)
      );
    }
  }

  return {
    committeeMembers,
    committeeSize: COMMITTEE_SIZE,
    election: electionDisplay,
    canVote: !!isMember,
    canRun: !!isMember,
    runCooldownUntil,
    userVotes,
    isCandidate,
    electionDuration: COMMITTEE_ELECTION_DURATION_TURNS,
  };
}
