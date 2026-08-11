import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { ELECTION_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { logRequest } from "@/lib/api/requestLog";
import { handleRouteError } from "@/lib/api/errors";
import { statePartyEnterSchema } from "@/lib/api/schemas/elections";
import { validateStatePartyElectionAccess } from "@/lib/utils/statePartyElectionValidation";
import { notifyCandidacyDeclared, POSITION_LABELS, ALL_POSITIONS } from "@/lib/statePartyElections";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import type { StatePartyCandidate, StatePartyElection } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getGameTime } from "@/lib/time/gameTime";
import { hasTurnBackedWindowClosed } from "@/lib/time/turnBackedWindow";
import {
  getPartyTenure,
  STATE_LEADERSHIP_RELOCATION_DELAY_TURNS,
} from "@/lib/parties/leadershipTenure";
import { isActiveStatePartyCandidateDuplicateKey } from "@/lib/elections/duplicateKey";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

// POST /api/country/[code]/region/[id]/party/[partyId]/election/enter — Enter or withdraw from a state party leadership election
// Auth: requireAuthWithCharacter (via validateStatePartyElectionAccess)
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  const start = Date.now();
  const path = new URL(request.url).pathname;
  try {
    const { code, id, partyId: routePartyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const resolvedStateId = id;

    const parsed = await parseJsonBody(request, statePartyEnterSchema);
    if (!parsed.success) {
      logRequest("POST", path, parsed.status, Date.now() - start);
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { position, withdraw } = parsed.data;

    const validation = await validateStatePartyElectionAccess(
      resolvedStateId,
      countryId,
      routePartyId,
      position
    );
    if (!validation.success) return validation.response;

    const { character, election, stateId, partyId } = validation;
    const gameTime = await getGameTime();

    const limit = checkRateLimit(
      `election:${character.userId.toString()}`,
      ELECTION_LIMITS.maxRequests,
      ELECTION_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const db = await getDb();
    const now = new Date(gameTime.effectiveNow);

    // Founding elections (pre-iteration) waive the 24h new-character cooldown,
    // party-tenure gate, and relocation delay — same posture as national
    // founding chair races — so brand-new players can seat state leadership.
    if (!election.founding) {
      // 24h new-character cooldown on state leadership actions.
      const userDoc = await db
        .collection("users")
        .findOne({ _id: character.userId }, { projection: { createdAt: 1 } });
      const cooldown = isInNewCharacterCooldown({
        userCreatedAt: userDoc?.createdAt ?? new Date(0),
        characterCreatedAt: character.createdAt,
        partyJoinedAt: character.partyJoinedAt,
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

      // Minimum party tenure before standing for state leadership (leadershipTenure.ts).
      const tenure = getPartyTenure(character.partyJoinedTurn, gameTime.currentTurn);
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

      // Relocation delay: recent movers can't immediately contest a new
      // state's party leadership (ticket #949).
      const relocTenure = getPartyTenure(
        character.lastRelocatedTurn,
        gameTime.currentTurn,
        STATE_LEADERSHIP_RELOCATION_DELAY_TURNS
      );
      if (!relocTenure.eligible) {
        logRequest("POST", path, 403, Date.now() - start);
        return NextResponse.json(
          {
            error: `You recently relocated. You can run for state party leadership in ${relocTenure.turnsRemaining} more turn${relocTenure.turnsRemaining === 1 ? "" : "s"}.`,
            turnsRemaining: relocTenure.turnsRemaining,
          },
          { status: 403 }
        );
      }
    }

    const existingCandidate = await db
      .collection<StatePartyCandidate>("statePartyCandidates")
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
        .collection<StatePartyCandidate>("statePartyCandidates")
        .updateOne(
          { _id: existingCandidate._id },
          { $set: { status: "withdrawn", withdrawnAt: now } }
        );
      logRequest("POST", path, 200, Date.now() - start);
      return NextResponse.json({
        success: true,
        message: `You have withdrawn from the ${POSITION_LABELS[position]} race`,
      });
    }

    // Entering — check they aren't already running for another position in this election cycle
    for (const otherPos of ALL_POSITIONS) {
      if (otherPos === position) continue;
      const otherElection = await db
        .collection<StatePartyElection>("statePartyElections")
        .findOne({ stateId, partyId, position: otherPos, status: "voting" });
      if (
        otherElection &&
        !hasTurnBackedWindowClosed(otherElection, gameTime.currentTurn, gameTime.effectiveNow)
      ) {
        const otherCand = await db
          .collection<StatePartyCandidate>("statePartyCandidates")
          .findOne({ electionId: otherElection._id, characterId: character._id, status: "active" });
        if (otherCand) {
          logRequest("POST", path, 400, Date.now() - start);
          return NextResponse.json(
            { error: `You are already running for ${POSITION_LABELS[otherPos]}. Withdraw first.` },
            { status: 400 }
          );
        }
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
      // Re-enter
      await db
        .collection<StatePartyCandidate>("statePartyCandidates")
        .updateOne(
          { _id: existingCandidate._id },
          { $set: { status: "active", enteredAt: now }, $unset: { withdrawnAt: "" } }
        );
      logRequest("POST", path, 200, Date.now() - start);
      return NextResponse.json({
        success: true,
        message: `You have re-entered the race for ${POSITION_LABELS[position]}`,
      });
    }

    const newCandidate: Omit<StatePartyCandidate, "_id"> = {
      electionId: election._id,
      characterId: character._id,
      characterName: character.name,
      stateId,
      partyId,
      countryId,
      position,
      enteredAt: now,
      status: "active",
    };

    try {
      await db.collection("statePartyCandidates").insertOne(newCandidate);
    } catch (error) {
      if (isActiveStatePartyCandidateDuplicateKey(error)) {
        const activeCandidate = await db
          .collection<StatePartyCandidate>("statePartyCandidates")
          .findOne({ stateId, partyId, characterId: character._id, status: "active" });

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
              error: `You are already running for ${POSITION_LABELS[activeCandidate.position]}. Withdraw first.`,
            },
            { status: 400 }
          );
        }
      }

      throw error;
    }

    // Notify other party members
    await notifyCandidacyDeclared(
      stateId,
      partyId,
      countryId,
      position,
      character.name,
      character._id
    );

    logRequest("POST", path, 200, Date.now() - start);
    return NextResponse.json({
      success: true,
      message: `You have entered the race for ${POSITION_LABELS[position]}`,
    });
  } catch (error) {
    logRequest("POST", path, 500, Date.now() - start);
    return handleRouteError(error);
  }
}
