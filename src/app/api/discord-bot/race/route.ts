import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { computeElectionPhase } from "@/lib/elections/phases";
import { getGameTime } from "@/lib/time/gameTime";
import {
  enrichElectionCandidates,
  type EnrichedCandidate,
} from "@/lib/elections/candidateEnrichment";
import { getPrimaryWinnersForElection, type CountryId } from "@/lib/constants/countries";
import { getOrCreateVoteTally } from "@/lib/elections/voteTallyService";
import { computeElectoralVotes } from "@/lib/elections/electoralVoteService";
import { buildCharacterHref, buildNppHref } from "@/lib/utils/profileUrls";
import { toAbsoluteUploadUrl } from "@/lib/discord";
import { buildActiveVisibleNppEndorsementFilter } from "@/lib/nppEndorsements";
import type {
  Election,
  ElectionCandidate,
  Character,
  NPP,
  PoliticalParty,
  GameState,
  NPPEndorsement,
  PlayerEndorsement,
  PrimarySnapshot,
  Campaign,
  StatePartyOrg,
  State,
} from "@/lib/db/types";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";

// GET /api/discord-bot/race — Returns detailed election race data including candidates, vote tallies, and phase information.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:race",
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const country = url.searchParams.get("country");
    const state = url.searchParams.get("state");
    const race = url.searchParams.get("race");
    const electionId = url.searchParams.get("electionId");

    // Must provide country, and optionally state + race to narrow down
    if (!country && !electionId) {
      return NextResponse.json(
        { error: "Must provide country (and optionally state/race), or electionId" },
        { status: 400 }
      );
    }

    const db = await getDb();

    let election: Election | null = null;

    if (electionId) {
      // Direct lookup by election ID
      const { ObjectId } = await import("mongodb");
      if (!ObjectId.isValid(electionId)) {
        return NextResponse.json({ error: "Invalid electionId" }, { status: 400 });
      }
      election = await db
        .collection<Election>("elections")
        .findOne({ _id: new ObjectId(electionId) });
    } else {
      // Find by country + state + race
      const query: Record<string, unknown> = {
        countryId: country,
        status: { $in: ["upcoming", "active"] },
      };
      if (state) query.state = state;
      if (race) query.electionType = race;

      // If no state or race given, just return the list of active races for this country
      if (!state && !race) {
        const elections = await db
          .collection<Election>("elections")
          .find(query)
          .sort({ endTime: 1 })
          .limit(30)
          .toArray();

        const stateIds = [...new Set(elections.map((e) => e.state))];
        const states = await db
          .collection<State>("states")
          .find({ _id: { $in: stateIds } })
          .toArray();
        const stateMap = new Map(states.map((s) => [s._id, s.name]));

        const summary = elections.map((e) => ({
          id: e._id.toString(),
          seatId: e.seatId ?? null,
          electionType: e.electionType,
          state: e.state,
          stateName: stateMap.get(e.state) ?? e.state,
          status: e.status,
          startTime: e.startTime?.toISOString() ?? null,
          endTime: e.endTime?.toISOString() ?? null,
        }));

        return NextResponse.json({ found: true, mode: "list", elections: summary });
      }

      // Find the best matching election
      election = await db
        .collection<Election>("elections")
        .findOne(query, { sort: { endTime: 1 } });
    }

    if (!election) {
      return NextResponse.json({ found: false, error: "No matching election found" });
    }

    // Fetch everything we need for the detail view
    const electionOid = election._id;
    const isPresident = election.electionType === "president";

    const candidates = await db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: electionOid, status: "active" })
      .toArray();

    const characterIds = candidates.filter((c) => !c.isNPP).map((c) => c.characterId);
    const runningMateIds = candidates.filter((c) => c.runningMateId).map((c) => c.runningMateId!);
    const allCharIds = [...new Set([...characterIds, ...runningMateIds])];
    const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);

    const [
      characters,
      npps,
      parties,
      endorsements,
      playerEndorsements,
      snapshots,
      statePartyOrgs,
      campaigns,
      gameState,
      stateDoc,
    ] = await Promise.all([
      allCharIds.length > 0
        ? db
            .collection<Character>("characters")
            .find({ _id: { $in: allCharIds } })
            .toArray()
        : [],
      nppIds.length > 0
        ? db
            .collection<NPP>("npps")
            .find({ _id: { $in: nppIds } })
            .toArray()
        : [],
      db
        .collection<PoliticalParty>("politicalParties")
        .find({ countryId: election.countryId ?? "US" })
        .toArray(),
      db
        .collection<NPPEndorsement>("nppEndorsements")
        .find(buildActiveVisibleNppEndorsementFilter({ electionId: electionOid }))
        .toArray(),
      db
        .collection<PlayerEndorsement>("playerEndorsements")
        .find({ electionId: electionOid, isActive: true })
        .toArray(),
      db
        .collection<PrimarySnapshot>("primarySnapshots")
        .find({ electionId: electionOid })
        .sort({ recordedAt: 1 })
        .limit(72)
        .toArray(),
      isPresident ? db.collection<StatePartyOrg>("statePartyOrg").find({}).toArray() : [],
      db
        .collection<Campaign>("campaigns")
        .find({ electionId: electionOid }, { projection: { _id: 1, candidateId: 1, funds: 1 } })
        .toArray(),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
      db
        .collection<State>("states")
        .findOne({ _id: election.state, countryId: election.countryId }),
    ]);

    // Enrich candidates
    const enrichedCandidates = enrichElectionCandidates({
      candidates,
      characters,
      npps,
      parties,
      nppEndorsements: endorsements,
      playerEndorsements,
      campaigns,
      statePartyOrgs,
      isPresident,
      myCharId: null,
    });

    // Compute phase
    const gameTime = await getGameTime();
    const phase = computeElectionPhase(
      election.startTime ?? null,
      election.primaryEndTime ?? null,
      election.endTime ?? null,
      election.status,
      gameTime,
      {
        startTurn: election.startTurn,
        primaryEndTurn: election.primaryEndTurn,
        endTurn: election.endTurn,
      }
    );

    // When primary is over, keep up to N nominees per party where N is the
    // primary-winner cap for this race (US=1, UK=3, JP=3; single-winner
    // governor/president races always 1).
    let displayCandidates: EnrichedCandidate[] = enrichedCandidates;
    if (!phase.inPrimary) {
      const maxPerParty = getPrimaryWinnersForElection(
        (election.countryId ?? "US") as CountryId,
        election.electionType
      );
      const partyCount = new Map<string, number>();
      displayCandidates = [];
      for (const c of [...enrichedCandidates].sort((a, b) => b.primaryScore - a.primaryScore)) {
        const used = partyCount.get(c.party) ?? 0;
        if (used < maxPerParty) {
          displayCandidates.push(c);
          partyCount.set(c.party, used + 1);
        }
      }
    }

    // Get vote tally
    const resolvedTally = await getOrCreateVoteTally(
      db,
      electionOid,
      election,
      candidates,
      displayCandidates,
      phase.inPrimary,
      phase.isEnded
    );

    // Electoral votes for presidential races
    // Safe: parties already filtered by election.countryId at query level
    const partyMap = new Map(parties.map((p) => [String(p.sequentialId), p]));
    let electoralVotes = {};
    if (isPresident && resolvedTally) {
      const candidateNameMap = new Map(enrichedCandidates.map((c) => [c.id, c.characterName]));
      electoralVotes = await computeElectoralVotes(db, resolvedTally, candidateNameMap, partyMap);
    }

    // Snapshot history for primary polling
    const snapshotHistory = snapshots.map((s) => ({
      recordedAt: s.recordedAt,
      byParty: s.byParty,
    }));

    // Build lookup maps for profile URLs
    const characterMap = new Map(characters.map((ch) => [ch._id.toString(), ch]));
    const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));

    // Format candidate data for bot
    const formattedCandidates = displayCandidates.map((c) => {
      // Determine profile URL based on whether candidate is NPP or player
      let profileUrl: string | null = null;
      if (c.isNPP && c.nppId) {
        const npp = nppMap.get(c.nppId);
        if (npp) profileUrl = `${BASE_URL}${buildNppHref(npp)}`;
      } else if (c.characterId) {
        const char = characterMap.get(c.characterId);
        if (char) profileUrl = `${BASE_URL}${buildCharacterHref(char)}`;
      }

      return {
        id: c.id,
        characterId: c.characterId,
        characterName: c.characterName,
        // Absolutise relative upload paths so Discord embeds can fetch them.
        avatarUrl: toAbsoluteUploadUrl(c.avatarUrl, BASE_URL),
        party: c.partyName,
        partyId: c.party,
        partyColor: c.partyColor,
        isNPP: c.isNPP,
        favorability: c.favorability,
        politicalInfluence: c.politicalInfluence,
        economicPosition: c.economicPosition,
        socialPosition: c.socialPosition,
        primaryScore: c.primaryScore,
        sharePct: c.sharePct,
        endorsementCount: c.endorsements.length,
        endorsements: c.endorsements.map((e) => ({
          type: e.type,
          name: e.type === "npp" ? e.nppName : e.characterName,
        })),
        runningMateName: c.runningMateName ?? null,
        campaignFunds: c.campaignFunds ?? null,
        profileUrl,
      };
    });

    // Format vote tally
    const votes = resolvedTally
      ? {
          totalVotes: resolvedTally.totalVotes,
          candidateNames: resolvedTally.candidateNames,
          candidateParties: resolvedTally.candidateParties,
          finalized: resolvedTally.finalized,
          seatsEstimate: resolvedTally.seatsEstimate ?? null,
          latestSnapshot:
            resolvedTally.turnSnapshots.length > 0
              ? (() => {
                  const latest =
                    resolvedTally.turnSnapshots[resolvedTally.turnSnapshots.length - 1];
                  return {
                    turn: latest.turn,
                    cumulativeVotes: latest.cumulativeVotes,
                    sharesPct: latest.sharesPct,
                  };
                })()
              : null,
          ...electoralVotes,
        }
      : null;

    // Get incumbent info if applicable
    const officeType = election.electionType;
    let incumbent: { name: string; party: string } | null = null;
    if (stateDoc) {
      // Try to find the current officeholder for this seat
      const officeQuery: Record<string, unknown> = {
        homeState: election.state,
        "currentOffice.type": officeType,
      };
      const incumbentChar = await db.collection<Character>("characters").findOne(officeQuery);
      if (incumbentChar) {
        const incumbentParty = partyMap.get(incumbentChar.party);
        incumbent = {
          name: incumbentChar.name,
          party:
            incumbentParty?.name ??
            (incumbentChar.party === "independent" ? "Independent" : incumbentChar.party),
        };
      }
    }

    return NextResponse.json({
      found: true,
      mode: "detail",
      election: {
        id: election._id.toString(),
        seatId: election.seatId ?? null,
        electionType: election.electionType,
        state: election.state,
        stateName: stateDoc?.name ?? election.state,
        countryId: election.countryId ?? "US",
        cycle: election.cycle,
        status: election.status,
        totalSeats: election.totalSeats ?? null,
        startTime: election.startTime?.toISOString() ?? null,
        endTime: election.endTime?.toISOString() ?? null,
        primaryEndTime: election.primaryEndTime?.toISOString() ?? null,
        url: election.seatId
          ? `${BASE_URL}/elections/${election.seatId}`
          : `${BASE_URL}/elections/${election._id}`,
      },
      phase: {
        inPrimary: phase.inPrimary,
        inGeneral: phase.inGeneral,
        isUpcoming: phase.isUpcoming,
        isEnded: phase.isEnded,
      },
      incumbent,
      candidates: formattedCandidates,
      primarySnapshots: phase.inPrimary ? snapshotHistory : [],
      votes,
      gameState: gameState
        ? {
            currentTurn: gameState.currentTurn,
            isActive: gameState.isActive,
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
