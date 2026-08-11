import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import { getPartyTenure } from "@/lib/parties/leadershipTenure";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { NATIONAL_ELECTION_DURATION_TURNS } from "@/lib/nationalPartyElections";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug } from "@/lib/db/caucusLookup";
import { getBannedCharacterIds } from "@/lib/utils/bannedCharacters";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type {
  CaucusChairCandidate,
  CaucusChairElection,
  CaucusChairVote,
  CaucusMembership,
  Character,
  GameState,
  NationalPartyElection,
} from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ code: string; id: string; slug: string }>;
}

// GET /api/country/[code]/parties/[id]/caucuses/[slug]/election — Return the active or most recent caucus chair election
// Auth: authenticated party member or admin
// Errors: 400, 401, 403, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const [db, authUser] = await Promise.all([
      getDb(),
      getAuthUserWithCharacter().catch(() => null),
    ]);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyId = String(party.sequentialId);
    const resolved = await findCaucusBySlug(db, countryId, partyId, slug);
    if (!resolved) {
      return NextResponse.json({ error: "Caucus not found" }, { status: 404 });
    }
    const { caucus } = resolved;

    const isViewerAllowed =
      authUser.isAdmin ||
      (authUser.character?.party === partyId && authUser.character?.countryId === caucus.countryId);
    if (!isViewerAllowed) {
      return NextResponse.json(
        { error: "Only party members may view caucus elections." },
        { status: 403 }
      );
    }

    let activeElection = await db.collection<CaucusChairElection>("caucusChairElections").findOne({
      caucusId: caucus._id,
      status: "voting",
    });
    const [latestElection, memberships] = await Promise.all([
      db
        .collection<CaucusChairElection>("caucusChairElections")
        .find({ caucusId: caucus._id, status: { $in: ["completed", "cancelled"] } })
        .sort({ endTime: -1 })
        .limit(1)
        .toArray(),
      db
        .collection<CaucusMembership>("caucusMemberships")
        .find({ caucusId: caucus._id, memberType: "character", status: "active" })
        .toArray(),
    ]);

    if (!activeElection && latestElection.length === 0) {
      const [gameState, activeNationalChairElection] = await Promise.all([
        db
          .collection<GameState>("gameState")
          .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
        db.collection<NationalPartyElection>("nationalPartyElections").findOne({
          partyId,
          countryId,
          position: "chair",
          status: "voting",
        }),
      ]);
      const currentTurn = gameState?.currentTurn ?? 0;
      const startTime = activeNationalChairElection?.startTime ?? new Date();
      const endTime =
        activeNationalChairElection?.endTime ??
        new Date(Date.now() + NATIONAL_ELECTION_DURATION_TURNS * 60 * 60 * 1000);
      const startTurn = activeNationalChairElection?.startTurn ?? currentTurn;
      const endTurn =
        activeNationalChairElection?.endTurn ?? currentTurn + NATIONAL_ELECTION_DURATION_TURNS;
      const inserted: CaucusChairElection = {
        _id: new ObjectId(),
        caucusId: caucus._id,
        partyId,
        countryId,
        status: "voting",
        startTime,
        endTime,
        startTurn,
        endTurn,
        durationTurns:
          activeNationalChairElection?.durationTurns ?? NATIONAL_ELECTION_DURATION_TURNS,
        winnerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await Promise.all([
        db.collection<CaucusChairElection>("caucusChairElections").insertOne(inserted),
        db
          .collection("caucuses")
          .updateOne(
            { _id: caucus._id },
            { $set: { nextElectionTurn: endTurn, updatedAt: new Date() } }
          ),
      ]);
      activeElection = inserted;
    }

    const election = activeElection ?? latestElection[0] ?? null;
    const memberIds = memberships.map((entry) => entry.memberId.toString());
    const isActiveMember =
      !!authUser.character && memberIds.includes(authUser.character._id.toString());
    let canParticipate = isActiveMember;
    if (isActiveMember && authUser.character) {
      const userDoc = await db
        .collection("users")
        .findOne({ _id: new ObjectId(authUser.userId) }, { projection: { createdAt: 1 } });
      const cooldown = isInNewCharacterCooldown({
        userCreatedAt: userDoc?.createdAt ?? new Date(0),
        characterCreatedAt: authUser.character.createdAt,
        partyJoinedAt: authUser.character.partyJoinedAt,
        includePartyJoinedAt: false,
      });
      canParticipate = !cooldown.blocked;
      // Turn-based party-tenure gate (leadershipTenure.ts) — pre-disable run/vote
      // for under-tenured members; the enter/vote routes enforce it server-side.
      const currentTurn = await getCurrentTurn(db);
      if (!getPartyTenure(authUser.character.partyJoinedTurn, currentTurn).eligible) {
        canParticipate = false;
      }
    }

    if (!election) {
      return NextResponse.json({
        election: null,
        currentHolder: caucus.chairId?.toString() ?? null,
        canVote: canParticipate,
        canRun: canParticipate,
        userVote: null,
        isCandidate: false,
      });
    }

    const bannedCharacterIds = await getBannedCharacterIds(db);
    const bannedVoterIds = [...bannedCharacterIds].map((entry) => new ObjectId(entry));
    const voteMatch: Record<string, unknown> = { electionId: election._id };
    if (bannedVoterIds.length > 0) {
      voteMatch.voterId = { $nin: bannedVoterIds };
    }

    const [allCandidatesRaw, voteCounts, userVote] = await Promise.all([
      db
        .collection<CaucusChairCandidate>("caucusChairCandidates")
        .find({ electionId: election._id, status: "active" })
        .toArray(),
      db
        .collection<CaucusChairVote>("caucusChairVotes")
        .aggregate<{ candidateId: ObjectId; count: number }>([
          { $match: voteMatch },
          { $group: { _id: "$candidateId", count: { $sum: 1 } } },
          { $project: { _id: 0, candidateId: "$_id", count: 1 } },
        ])
        .toArray(),
      authUser.character && election.status === "voting"
        ? db.collection<CaucusChairVote>("caucusChairVotes").findOne({
            electionId: election._id,
            voterId: authUser.character._id,
          })
        : Promise.resolve(null),
    ]);

    const candidates = allCandidatesRaw.filter(
      (candidate) => !bannedCharacterIds.has(candidate.characterId.toString())
    );
    const characterIds = candidates.map((entry) => entry.characterId);
    const characters =
      characterIds.length > 0
        ? await db
            .collection<Character>("characters")
            .find({ _id: { $in: characterIds } })
            .toArray()
        : [];
    const sequentialIdMap = new Map(
      characters.map((entry) => [entry._id.toString(), entry.sequentialId])
    );
    const activeCandidateIds = new Set(
      candidates.map((candidate) => candidate.characterId.toString())
    );

    const voteCountMap = new Map<string, number>();
    let totalVotes = 0;
    for (const entry of voteCounts) {
      if (!activeCandidateIds.has(entry.candidateId.toString())) continue;
      voteCountMap.set(entry.candidateId.toString(), entry.count);
      totalVotes += entry.count;
    }

    const winnerCandidate = election.winnerId
      ? candidates.find((candidate) => candidate.characterId.equals(election.winnerId))
      : null;

    return NextResponse.json({
      election: {
        id: election._id.toString(),
        status: election.status,
        startTime: election.startTime.toISOString(),
        endTime: election.endTime.toISOString(),
        startTurn: election.startTurn,
        endTurn: election.endTurn,
        durationTurns: election.durationTurns,
        candidates: candidates.map((candidate) => ({
          id: candidate._id.toString(),
          characterId: candidate.characterId.toString(),
          sequentialId: sequentialIdMap.get(candidate.characterId.toString()),
          characterName: candidate.characterName,
          voteCount: voteCountMap.get(candidate.characterId.toString()) ?? 0,
          isCurrentHolder:
            !!caucus.chairId && caucus.chairId.toString() === candidate.characterId.toString(),
        })),
        totalVotes,
        winnerId: election.winnerId?.toString() ?? null,
        winnerName: winnerCandidate?.characterName ?? null,
      },
      currentHolder: caucus.chairId?.toString() ?? null,
      canVote: canParticipate,
      canRun: canParticipate,
      userVote:
        userVote && activeCandidateIds.has(userVote.candidateId.toString())
          ? {
              candidateId: userVote.candidateId.toString(),
              candidateName:
                candidates.find((candidate) => candidate.characterId.equals(userVote.candidateId))
                  ?.characterName ?? "Unknown",
            }
          : null,
      isCandidate:
        !!authUser.character &&
        candidates.some((candidate) => candidate.characterId.equals(authUser.character!._id)),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
