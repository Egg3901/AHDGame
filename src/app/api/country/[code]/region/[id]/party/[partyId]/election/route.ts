import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import {
  getPartyTenure,
  STATE_LEADERSHIP_RELOCATION_DELAY_TURNS,
} from "@/lib/parties/leadershipTenure";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { ALL_POSITIONS } from "@/lib/statePartyElections";
import { getBannedCharacterIds } from "@/lib/utils/bannedCharacters";
import type {
  StatePartyElection,
  StatePartyElectionPosition,
  StatePartyCandidate,
  StatePartyVote,
  StatePartyOrg,
  State,
  Character,
} from "@/lib/db/types";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";

/** Get position labels appropriate for the country (UK uses "Regional Chair") */
function getPositionLabels(countryId: CountryId): Record<StatePartyElectionPosition, string> {
  const config = getCountryConfig(countryId);
  const chairLabel = config.regionLabel === "Nation" ? "Regional Chair" : "State Chair";
  return {
    chair: chairLabel,
    viceChair: "Vice Chair",
    treasurer: "Treasurer",
  };
}

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

interface CandidateDisplay {
  id: string;
  characterId: string;
  characterName: string;
  voteCount: number;
  isCurrentHolder: boolean; // holds the position they're running for
  sequentialId?: number;
}

interface ElectionDisplay {
  id: string;
  position: StatePartyElectionPosition;
  positionLabel: string;
  status: "voting" | "completed" | "cancelled";
  startTime: string;
  endTime: string;
  startTurn: number;
  endTurn: number;
  durationTurns: number;
  candidates: CandidateDisplay[];
  totalVotes: number;
  winnerId: string | null;
  winnerName: string | null;
}

// GET /api/country/[code]/region/[id]/party/[partyId]/election — Return active or most recent state party leadership elections for all positions
// Auth: public
// Errors: 400, 404
/**
 * GET /api/state/[id]/party/[partyId]/election
 *
 * Returns the active (or most-recently-completed) election for all three
 * leadership positions for this state party.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    // Get country-appropriate position labels (UK uses "Regional Chair")
    const positionLabels = getPositionLabels(countryId);

    const db = await getDb();

    // Parallel: state, auth
    const [state, authUser] = await Promise.all([
      db.collection<State>("states").findOne({ _id: stateId, countryId }),
      getAuthUserWithCharacter().catch(() => null),
    ]);

    // Party lookup by sequential ID
    const party = await findPartyBySequentialId(db, partyId, countryId);

    if (!state) return NextResponse.json({ error: "State not found" }, { status: 404 });
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    const partyKey = getPartyIdString(party);

    const isMember =
      authUser?.character?.homeState === stateId && authUser?.character?.party === partyKey;
    let canParticipate = isMember;
    let cooldownBlockedUntil: string | null = null;
    let canVoteReason: "membership" | "cooldown" | "tenure" | null = null;
    let tenureTurnsRemaining: number | null = null;
    /**
     * Turns until this viewer may take part, across BOTH gates: the wall-clock
     * new-account cooldown and the turn-counted party-tenure requirement.
     *
     * The two gates were reported separately and the client only ever showed the
     * first one, so a member who was inside the 24h cooldown AND under-tenured
     * saw "wait 24 hours" while the real block ran longer, against an election
     * whose own countdown is in turns. A turn is one real hour, so both gates
     * convert to the same unit and the longer of the two is the honest answer.
     */
    let turnsUntilEligible: number | null = null;

    // Get statePartyOrg for current holders
    const org = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: getStatePartyOrgDocumentId(stateId, party) });

    const holderMap: Record<StatePartyElectionPosition, string | null> = {
      chair: org?.chairId?.toString() ?? null,
      viceChair: org?.viceChairId?.toString() ?? null,
      treasurer: org?.treasurerId?.toString() ?? null,
    };

    // Batch 1: all active (voting) elections for this state party across all positions
    const activeElections = await db
      .collection<StatePartyElection>("statePartyElections")
      .find({ stateId, partyId: partyKey, position: { $in: ALL_POSITIONS }, status: "voting" })
      .toArray();

    // Founding races waive cooldown/tenure/relocation for the UI pre-disable
    // (enter/vote enforce the same server-side). Checked before gating so the
    // panel doesn't show "24 turns more" against a founding election.
    const hasFoundingElection = activeElections.some((election) => election.founding === true);

    if (isMember && authUser?.character && !hasFoundingElection) {
      const userDoc = await db
        .collection("users")
        .findOne({ _id: authUser.character.userId }, { projection: { createdAt: 1 } });
      const cooldown = isInNewCharacterCooldown({
        userCreatedAt: userDoc?.createdAt ?? new Date(0),
        characterCreatedAt: authUser.character.createdAt,
        partyJoinedAt: authUser.character.partyJoinedAt,
        includePartyJoinedAt: false,
      });
      if (cooldown.blocked) {
        canParticipate = false;
        cooldownBlockedUntil = cooldown.unblockAt.toISOString();
        canVoteReason = "cooldown";
        turnsUntilEligible = Math.max(
          1,
          Math.ceil((cooldown.unblockAt.getTime() - Date.now()) / MS_PER_TURN)
        );
      }
      // Turn-based party-tenure gate (leadershipTenure.ts) — pre-disable run/vote
      // for under-tenured members; the enter/vote routes enforce it server-side.
      const currentTurn = await getCurrentTurn(db);
      const tenure = getPartyTenure(authUser.character.partyJoinedTurn, currentTurn);
      if (!tenure.eligible) {
        canParticipate = false;
        canVoteReason = "tenure";
        tenureTurnsRemaining = tenure.turnsRemaining;
        turnsUntilEligible = Math.max(turnsUntilEligible ?? 0, tenure.turnsRemaining);
      }
      // Relocation delay (ticket #949) — recent movers can't contest a new
      // state's party leadership; enter route enforces server-side.
      const relocTenure = getPartyTenure(
        authUser.character.lastRelocatedTurn,
        currentTurn,
        STATE_LEADERSHIP_RELOCATION_DELAY_TURNS
      );
      if (!relocTenure.eligible) {
        canParticipate = false;
        canVoteReason = "tenure";
        tenureTurnsRemaining = Math.max(tenureTurnsRemaining ?? 0, relocTenure.turnsRemaining);
        turnsUntilEligible = Math.max(turnsUntilEligible ?? 0, relocTenure.turnsRemaining);
      }
    } else if (!isMember) {
      canVoteReason = "membership";
    }

    const activePositions = new Set(activeElections.map((e) => e.position));
    const missingPositions = ALL_POSITIONS.filter((p) => !activePositions.has(p));

    // Batch 2: most-recent completed/cancelled election per missing position
    let completedElections: StatePartyElection[] = [];
    if (missingPositions.length > 0) {
      completedElections = await db
        .collection<StatePartyElection>("statePartyElections")
        .aggregate<StatePartyElection>([
          {
            $match: {
              stateId,
              partyId: partyKey,
              position: { $in: missingPositions },
              status: { $in: ["completed", "cancelled"] },
            },
          },
          { $sort: { endTime: -1 } },
          { $group: { _id: "$position", doc: { $first: "$$ROOT" } } },
          { $replaceRoot: { newRoot: "$doc" } },
        ])
        .toArray();
    }

    const electionByPosition = new Map<StatePartyElectionPosition, StatePartyElection>();
    for (const e of [...activeElections, ...completedElections]) {
      electionByPosition.set(e.position, e);
    }

    const electionIds = [...electionByPosition.values()].map((e) => e._id);

    if (electionIds.length === 0) {
      return NextResponse.json({
        elections: { chair: null, viceChair: null, treasurer: null },
        currentHolders: holderMap,
        canVote: canParticipate,
        canRunForChair: canParticipate,
        cooldownBlockedUntil,
        userVotes: { chair: null, viceChair: null, treasurer: null },
        isCandidate: { chair: false, viceChair: false, treasurer: false },
        canVoteReason,
        tenureTurnsRemaining,
        turnsUntilEligible,
      });
    }

    const activeElectionIds = activeElections.map((e) => e._id);

    // Resolve banned characters once so display vote counts match what the
    // tally code uses at resolution time.
    const bannedCharacterIds = await getBannedCharacterIds(db);
    const bannedVoterObjectIds = [...bannedCharacterIds].map((id) => new ObjectId(id));

    const voteMatch: Record<string, unknown> = { electionId: { $in: electionIds } };
    if (bannedVoterObjectIds.length > 0) {
      voteMatch.voterId = { $nin: bannedVoterObjectIds };
    }

    // Batch 3: all candidates, Batch 4: vote counts, Batch 5: user votes — all in parallel
    const [allCandidatesRaw, allVoteCounts, allUserVotes] = await Promise.all([
      db
        .collection<StatePartyCandidate>("statePartyCandidates")
        // electionIds spans active (voting) AND most-recent completed elections
        // for missing positions. Resolved elections terminalize candidacies to
        // "completed", so include those (and "active") while excluding player
        // withdrawals — otherwise concluded-race results render with no candidates.
        .find({ electionId: { $in: electionIds }, status: { $ne: "withdrawn" } })
        .toArray(),
      db
        .collection<StatePartyVote>("statePartyVotes")
        .aggregate<{ electionId: ObjectId; candidateId: ObjectId; count: number }>([
          { $match: voteMatch },
          {
            $group: {
              _id: { electionId: "$electionId", candidateId: "$candidateId" },
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              electionId: "$_id.electionId",
              candidateId: "$_id.candidateId",
              count: 1,
            },
          },
        ])
        .toArray(),
      authUser?.character && activeElectionIds.length > 0
        ? db
            .collection<StatePartyVote>("statePartyVotes")
            .find({ electionId: { $in: activeElectionIds }, voterId: authUser.character._id })
            .toArray()
        : Promise.resolve([] as StatePartyVote[]),
    ]);

    const allCandidates = allCandidatesRaw.filter(
      (c) => !bannedCharacterIds.has(c.characterId.toString())
    );

    // Index by electionId for O(1) assembly
    const candidatesByElection = new Map<string, StatePartyCandidate[]>();
    for (const c of allCandidates) {
      const key = c.electionId.toString();
      if (!candidatesByElection.has(key)) candidatesByElection.set(key, []);
      candidatesByElection.get(key)!.push(c);
    }

    // Fetch characters to get sequentialIds
    const candidateCharacterIds = allCandidates.map((c) => c.characterId);
    const candidateCharacters =
      candidateCharacterIds.length > 0
        ? await db
            .collection<Character>("characters")
            .find({ _id: { $in: candidateCharacterIds } })
            .toArray()
        : [];
    const characterSeqIdMap = new Map(
      candidateCharacters.map((c) => [c._id.toString(), c.sequentialId])
    );

    // Build per-election sets of active candidate character IDs so we can ignore
    // stale votes (e.g. for candidates who later withdrew). Without this filter,
    // totalVotes inflates and percentages become misleading (e.g. 50% with 1 candidate).
    const activeCharIdsByElection = new Map<string, Set<string>>();
    for (const c of allCandidates) {
      const eid = c.electionId.toString();
      let set = activeCharIdsByElection.get(eid);
      if (!set) {
        set = new Set<string>();
        activeCharIdsByElection.set(eid, set);
      }
      set.add(c.characterId.toString());
    }

    const voteCountMap = new Map<string, Map<string, number>>();
    const totalVotesByElection = new Map<string, number>();
    for (const v of allVoteCounts) {
      const eid = v.electionId.toString();
      const cid = v.candidateId.toString();
      // Skip votes for candidates who are no longer active in this election.
      if (!activeCharIdsByElection.get(eid)?.has(cid)) continue;
      if (!voteCountMap.has(eid)) voteCountMap.set(eid, new Map());
      voteCountMap.get(eid)!.set(cid, v.count);
      totalVotesByElection.set(eid, (totalVotesByElection.get(eid) ?? 0) + v.count);
    }

    const userVoteByElection = new Map<string, StatePartyVote>();
    for (const v of allUserVotes) {
      userVoteByElection.set(v.electionId.toString(), v);
    }

    // Assemble response
    const elections: Record<StatePartyElectionPosition, ElectionDisplay | null> = {
      chair: null,
      viceChair: null,
      treasurer: null,
    };
    const userVotes: Record<
      StatePartyElectionPosition,
      { candidateId: string; candidateName: string } | null
    > = { chair: null, viceChair: null, treasurer: null };
    const isCandidate: Record<StatePartyElectionPosition, boolean> = {
      chair: false,
      viceChair: false,
      treasurer: false,
    };

    for (const position of ALL_POSITIONS) {
      const election = electionByPosition.get(position);
      if (!election) continue;

      const eid = election._id.toString();
      const candidates = candidatesByElection.get(eid) ?? [];
      const elecVoteMap = voteCountMap.get(eid) ?? new Map<string, number>();
      const totalVotes = totalVotesByElection.get(eid) ?? 0;

      const candidateDisplay: CandidateDisplay[] = candidates
        .map((c) => ({
          id: c._id.toString(),
          characterId: c.characterId.toString(),
          characterName: c.characterName,
          voteCount: elecVoteMap.get(c.characterId.toString()) ?? 0,
          isCurrentHolder: c.characterId.toString() === holderMap[position],
          sequentialId: characterSeqIdMap.get(c.characterId.toString()),
        }))
        .sort((a, b) => b.voteCount - a.voteCount || a.id.localeCompare(b.id));

      let winnerName: string | null = null;
      if (election.winnerId) {
        const winnerId = election.winnerId;
        winnerName = candidates.find((c) => c.characterId.equals(winnerId))?.characterName ?? null;
      }

      elections[position] = {
        id: eid,
        position,
        positionLabel: positionLabels[position],
        status: election.status,
        startTime: election.startTime.toISOString(),
        endTime: election.endTime.toISOString(),
        startTurn: election.startTurn ?? 0,
        endTurn: election.endTurn ?? 0,
        durationTurns: election.durationTurns ?? 96,
        candidates: candidateDisplay,
        totalVotes,
        winnerId: election.winnerId?.toString() ?? null,
        winnerName,
      };

      if (authUser?.character && election.status === "voting") {
        const vote = userVoteByElection.get(eid);
        if (vote) {
          const votedCand = candidates.find((c) => c.characterId.equals(vote.candidateId));
          userVotes[position] = {
            candidateId: vote.candidateId.toString(),
            candidateName: votedCand?.characterName ?? "Unknown",
          };
        }
        isCandidate[position] = candidates.some((c) =>
          c.characterId.equals(authUser!.character!._id)
        );
      }
    }

    return NextResponse.json({
      elections,
      currentHolders: holderMap,
      canVote: canParticipate,
      canRunForChair: canParticipate,
      cooldownBlockedUntil,
      userVotes,
      isCandidate,
      canVoteReason,
      tenureTurnsRemaining,
      turnsUntilEligible,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
