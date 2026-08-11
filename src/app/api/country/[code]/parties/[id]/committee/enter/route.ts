import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import { z } from "zod";
import { notifyCommitteeCandidacyDeclared } from "@/lib/nationalCommitteeElections";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type {
  NationalCommitteeElection,
  NationalCommitteeCandidate,
  NationalPartyElection,
  NationalPartyCandidate,
  NationalPartyElectionPosition,
} from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import { hasTurnBackedWindowClosed } from "@/lib/time/turnBackedWindow";
import { isActiveNationalCommitteeCandidateDuplicateKey } from "@/lib/elections/duplicateKey";
import { isSameCountry } from "@/lib/api/sameCountry";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/parties/[id]/committee/enter — Enter or withdraw from the national committee election
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
/**
 * POST /api/parties/[id]/committee/enter
 *
 * Enter or withdraw from the National Committee election.
 * body: { withdraw?: boolean }
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const db = await getDb();

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;
    if (authResult.user.isBanned) {
      return NextResponse.json({ error: "Account is banned" }, { status: 403 });
    }

    const rateLimit = checkRateLimit(authResult.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = authResult.user;

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) return NextResponse.json({ error: "Party not found" }, { status: 404 });

    // Must match both party AND country to avoid cross-country collisions
    const partyCountryId = party.countryId ?? "US";
    if (authUser.character.party !== partyId || !isSameCountry(authUser.character, party)) {
      return NextResponse.json({ error: "You must be a member of this party" }, { status: 403 });
    }

    // 24h new-character cooldown on committee actions.
    const userDoc = await db
      .collection("users")
      .findOne({ _id: new ObjectId(authUser.userId) }, { projection: { createdAt: 1 } });
    const cooldown = isInNewCharacterCooldown({
      userCreatedAt: userDoc?.createdAt ?? new Date(0),
      characterCreatedAt: authUser.character.createdAt,
      partyJoinedAt: authUser.character.partyJoinedAt,
    });
    if (cooldown.blocked) {
      return NextResponse.json(
        {
          error: "New characters can't run for national committee for 24 hours. Try again later.",
          unblockAt: cooldown.unblockAt.toISOString(),
        },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, z.object({ withdraw: z.boolean().optional() }));
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { withdraw } = parsed.data;

    // Find active election for this party in this country
    const election = await db
      .collection<NationalCommitteeElection>("nationalCommitteeElections")
      .findOne({ partyId, countryId: partyCountryId, status: "voting" });

    if (!election) {
      return NextResponse.json({ error: "No active committee election" }, { status: 400 });
    }

    const gameTime = await getGameTime();
    if (hasTurnBackedWindowClosed(election, gameTime.currentTurn, gameTime.effectiveNow)) {
      return NextResponse.json(
        {
          error:
            "Voting for this committee election has ended. " +
            "A new election opens automatically each turn — please refresh shortly to declare for the next cycle.",
        },
        { status: 400 }
      );
    }

    const now = new Date(gameTime.effectiveNow);
    const characterId = authUser.character._id;
    const characterName = authUser.character.name;

    // Check existing candidacy
    const existingCandidacy = await db
      .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
      .findOne({ electionId: election._id, characterId });

    if (withdraw) {
      if (!existingCandidacy || existingCandidacy.status === "withdrawn") {
        return NextResponse.json(
          { error: "You are not a candidate in this election" },
          { status: 400 }
        );
      }

      await db
        .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
        .updateOne(
          { _id: existingCandidacy._id },
          { $set: { status: "withdrawn", withdrawnAt: now } }
        );

      return NextResponse.json({
        success: true,
        message: `You have withdrawn from the ${getPartyRoleLabel(partyCountryId, "committee")} election`,
      });
    }

    const openLeadershipElections = await db
      .collection<NationalPartyElection>("nationalPartyElections")
      .find({ partyId, countryId: partyCountryId, status: "voting" })
      .toArray();
    const activeLeadershipElections = openLeadershipElections.filter(
      (leadershipElection) =>
        !hasTurnBackedWindowClosed(leadershipElection, gameTime.currentTurn, gameTime.effectiveNow)
    );
    if (activeLeadershipElections.length > 0) {
      const leadershipCandidate = await db
        .collection<NationalPartyCandidate>("nationalPartyCandidates")
        .findOne({
          electionId: {
            $in: activeLeadershipElections.map((leadershipElection) => leadershipElection._id),
          },
          characterId,
          status: "active",
        });

      if (leadershipCandidate) {
        const blockingElection = activeLeadershipElections.find((leadershipElection) =>
          leadershipElection._id.equals(leadershipCandidate.electionId)
        );
        const blockingPosition = (blockingElection?.position ??
          leadershipCandidate.position) as NationalPartyElectionPosition;
        return NextResponse.json(
          {
            error: `You are already running for ${getPartyRoleLabel(partyCountryId, blockingPosition)}. Withdraw first before entering the ${getPartyRoleLabel(partyCountryId, "committee")} election.`,
          },
          { status: 400 }
        );
      }
    }

    // Entering the race
    if (existingCandidacy && existingCandidacy.status === "active") {
      return NextResponse.json(
        { error: "You are already a candidate in this election" },
        { status: 400 }
      );
    }

    if (existingCandidacy && existingCandidacy.status === "withdrawn") {
      // Re-enter
      await db
        .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
        .updateOne(
          { _id: existingCandidacy._id },
          { $set: { status: "active", enteredAt: now }, $unset: { withdrawnAt: "" } }
        );
    } else {
      // New candidacy
      const candidacy: Omit<NationalCommitteeCandidate, "_id"> = {
        electionId: election._id,
        characterId,
        characterName,
        partyId,
        countryId: partyCountryId,
        enteredAt: now,
        status: "active",
      };

      try {
        await db.collection("nationalCommitteeCandidates").insertOne(candidacy);
      } catch (error) {
        if (isActiveNationalCommitteeCandidateDuplicateKey(error)) {
          const activeCandidate = await db
            .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
            .findOne({ partyId, characterId, status: "active" });

          if (activeCandidate) {
            return NextResponse.json(
              { error: "You are already a candidate in this election" },
              { status: 400 }
            );
          }
        }

        throw error;
      }
    }

    // Notify party members
    await notifyCommitteeCandidacyDeclared(partyId, partyCountryId, characterName, characterId);

    return NextResponse.json({
      success: true,
      message: `You have entered the ${getPartyRoleLabel(partyCountryId, "committee")} election`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
