import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, ELECTION_LIMITS, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { handleRouteError } from "@/lib/api/errors";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import { nationalPartyEnterSchema } from "@/lib/api/schemas/elections";
import {
  NATIONAL_ALL_POSITIONS,
  notifyNationalCandidacyDeclared,
} from "@/lib/nationalPartyElections";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type {
  NationalPartyElection,
  NationalPartyCandidate,
  NationalPartyElectionPosition,
  NationalCommitteeElection,
  NationalCommitteeCandidate,
} from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameTime } from "@/lib/time/gameTime";
import { getPartyTenure } from "@/lib/parties/leadershipTenure";
import { hasTurnBackedWindowClosed } from "@/lib/time/turnBackedWindow";
import { isActiveNationalPartyCandidateDuplicateKey } from "@/lib/elections/duplicateKey";
import { isSameCountry } from "@/lib/api/sameCountry";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/parties/[id]/election/enter — Enter or withdraw from a national party leadership election
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) {
      logRequest("POST", path, 401, Date.now() - start);
      return authResult.response;
    }
    if (authResult.user.isBanned) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json({ error: "Account is banned" }, { status: 403 });
    }
    const authUser = authResult.user;

    const limit = checkRateLimit(
      `election:${authUser.userId}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!limit.ok) {
      logRequest("POST", path, 429, Date.now() - start);
      return rateLimitResponse(limit.retryAfter);
    }

    const parsed = await parseJsonBody(request, nationalPartyEnterSchema);
    if (!parsed.success) {
      logRequest("POST", path, parsed.status, Date.now() - start);
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { position, withdraw } = parsed.data;

    // countryId already extracted from path params

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      logRequest("POST", path, 404, Date.now() - start);
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    // Verify membership: must match both party sequential ID AND country
    const partyCountryId = party.countryId ?? "US";
    if (authUser.character.party !== partyId || !isSameCountry(authUser.character, party)) {
      logRequest("POST", path, 403, Date.now() - start);
      return NextResponse.json(
        { error: "You must be a member of this party to participate" },
        { status: 403 }
      );
    }

    // Filter by countryId to avoid cross-country sequential ID collisions
    const election = await db
      .collection<NationalPartyElection>("nationalPartyElections")
      .findOne({ partyId, countryId: partyCountryId, position, status: "voting" });

    if (!election) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json(
        { error: `No active ${position} election for this party` },
        { status: 400 }
      );
    }

    const gameTime = await getGameTime();
    if (hasTurnBackedWindowClosed(election, gameTime.currentTurn, gameTime.effectiveNow)) {
      logRequest("POST", path, 400, Date.now() - start);
      return NextResponse.json(
        {
          error:
            `Voting for this ${position} election has ended. ` +
            `A new election opens automatically each turn — please refresh shortly to declare for the next cycle.`,
        },
        { status: 400 }
      );
    }

    // 24h new-character cooldown on leadership actions. Waived for founding
    // elections (the accelerated 12-turn chair race at iteration start) so
    // brand-new players can stand immediately.
    if (!election.founding) {
      const userDoc = await db
        .collection("users")
        .findOne({ _id: new ObjectId(authUser.userId) }, { projection: { createdAt: 1 } });
      const cooldown = isInNewCharacterCooldown({
        userCreatedAt: userDoc?.createdAt ?? new Date(0),
        characterCreatedAt: authUser.character.createdAt,
        partyJoinedAt: authUser.character.partyJoinedAt,
        includePartyJoinedAt: false,
      });
      if (cooldown.blocked) {
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json(
          {
            error:
              "New characters can't participate in party leadership for 24 hours. Try again later.",
            unblockAt: cooldown.unblockAt.toISOString(),
          },
          { status: 403 }
        );
      }
    }

    // Must have been a party member for a minimum number of turns before
    // standing for leadership (see leadershipTenure.ts). Independent of the
    // 24h new-character cooldown above; likewise waived for founding elections.
    if (!election.founding) {
      const tenure = getPartyTenure(authUser.character.partyJoinedTurn, gameTime.currentTurn);
      if (!tenure.eligible) {
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json(
          {
            error: `You must be a member of this party for ${tenure.turnsRemaining} more turn${tenure.turnsRemaining === 1 ? "" : "s"} before you can run for leadership.`,
            turnsRemaining: tenure.turnsRemaining,
          },
          { status: 403 }
        );
      }
    }

    const now = new Date(gameTime.effectiveNow);
    const character = authUser.character;

    const existingCandidate = await db
      .collection<NationalPartyCandidate>("nationalPartyCandidates")
      .findOne({ electionId: election._id, characterId: character._id });

    if (withdraw) {
      if (!existingCandidate || existingCandidate.status === "withdrawn") {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          { error: "You are not an active candidate in this election" },
          { status: 400 }
        );
      }
      await db
        .collection<NationalPartyCandidate>("nationalPartyCandidates")
        .updateOne(
          { _id: existingCandidate._id },
          { $set: { status: "withdrawn", withdrawnAt: now } }
        );
      logRequest("POST", path, 200, Date.now() - start);
      return NextResponse.json({
        success: true,
        message: `You have withdrawn from the ${getPartyRoleLabel(partyCountryId, position)} race`,
      });
    }

    // Block running for multiple national positions at once (batched queries)
    // Filter by countryId to avoid cross-country sequential ID collisions
    const otherPositions = NATIONAL_ALL_POSITIONS.filter((p) => p !== position);
    const otherElections = await db
      .collection<NationalPartyElection>("nationalPartyElections")
      .find({
        partyId,
        countryId: partyCountryId,
        status: "voting",
        position: { $in: otherPositions },
      })
      .toArray();
    const openOtherElections = otherElections.filter(
      (otherElection) =>
        !hasTurnBackedWindowClosed(otherElection, gameTime.currentTurn, gameTime.effectiveNow)
    );
    if (openOtherElections.length > 0) {
      const otherElectionIds = openOtherElections.map((e) => e._id);
      const blockingCand = await db
        .collection<NationalPartyCandidate>("nationalPartyCandidates")
        .findOne({
          electionId: { $in: otherElectionIds },
          characterId: character._id,
          status: "active",
        });
      if (blockingCand) {
        const blockingElection = openOtherElections.find((e) =>
          e._id.equals(blockingCand.electionId)
        );
        const blockedPos = (blockingElection?.position ?? "chair") as NationalPartyElectionPosition;
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          {
            error: `You are already running for ${getPartyRoleLabel(partyCountryId, blockedPos)}. Withdraw first.`,
          },
          { status: 400 }
        );
      }
    }

    const openCommitteeElection = await db
      .collection<NationalCommitteeElection>("nationalCommitteeElections")
      .findOne({ partyId, countryId: partyCountryId, status: "voting" });
    if (
      openCommitteeElection &&
      !hasTurnBackedWindowClosed(openCommitteeElection, gameTime.currentTurn, gameTime.effectiveNow)
    ) {
      const committeeCandidate = await db
        .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
        .findOne({
          electionId: openCommitteeElection._id,
          characterId: character._id,
          status: "active",
        });
      if (committeeCandidate) {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          {
            error: `You are already running for ${getPartyRoleLabel(partyCountryId, "committee")}. Withdraw first before entering a national leadership race.`,
          },
          { status: 400 }
        );
      }
    }

    if (existingCandidate) {
      if (existingCandidate.status === "active") {
        logRequest("POST", path, 400, Date.now() - start);
        return NextResponse.json(
          { error: "You are already a candidate in this election" },
          { status: 400 }
        );
      }
      await db
        .collection<NationalPartyCandidate>("nationalPartyCandidates")
        .updateOne(
          { _id: existingCandidate._id },
          { $set: { status: "active", enteredAt: now }, $unset: { withdrawnAt: "" } }
        );
      logRequest("POST", path, 200, Date.now() - start);
      return NextResponse.json({
        success: true,
        message: `You have re-entered the race for ${getPartyRoleLabel(partyCountryId, position)}`,
      });
    }

    const newCandidate: Omit<NationalPartyCandidate, "_id"> = {
      electionId: election._id,
      characterId: character._id,
      characterName: character.name,
      partyId,
      countryId: partyCountryId,
      position,
      enteredAt: now,
      status: "active",
    };

    try {
      await db.collection("nationalPartyCandidates").insertOne(newCandidate);
    } catch (error) {
      if (isActiveNationalPartyCandidateDuplicateKey(error)) {
        const activeCandidate = await db
          .collection<NationalPartyCandidate>("nationalPartyCandidates")
          .findOne({ partyId, characterId: character._id, status: "active" });

        if (activeCandidate?.electionId.equals(election._id)) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: "You are already a candidate in this election" },
            { status: 400 }
          );
        }

        if (activeCandidate) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            {
              error: `You are already running for ${getPartyRoleLabel(partyCountryId, activeCandidate.position)}. Withdraw first.`,
            },
            { status: 400 }
          );
        }
      }

      throw error;
    }
    await notifyNationalCandidacyDeclared(
      partyId,
      position,
      character.name,
      character._id,
      countryId
    );

    logRequest("POST", path, 200, Date.now() - start);
    return NextResponse.json({
      success: true,
      message: `You have entered the race for ${getPartyRoleLabel(partyCountryId, position)}`,
    });
  } catch (error) {
    logRequest("POST", path, 500, Date.now() - start);
    return handleRouteError(error);
  }
}
