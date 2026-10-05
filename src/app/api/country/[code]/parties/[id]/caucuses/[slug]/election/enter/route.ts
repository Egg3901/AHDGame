import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import { getLeadershipEligibility } from "@/lib/parties/leadershipTenure";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug } from "@/lib/db/caucusLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CaucusChairCandidate, CaucusChairElection, CaucusMembership } from "@/lib/db/types";

const bodySchema = z.object({
  withdraw: z.boolean().optional(),
});

// POST /api/country/[code]/parties/[id]/caucuses/[slug]/election/enter — Enter or withdraw from the caucus chair election
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 409
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; slug: string }> }
) {
  try {
    const { code, id, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return errorResponse(404, "Party not found");
    }
    const partyId = String(party.sequentialId);
    const resolved = await findCaucusBySlug(db, countryId, partyId, slug);
    if (!resolved) {
      return errorResponse(404, "Caucus not found");
    }
    const { caucus } = resolved;

    const membership = await db.collection<CaucusMembership>("caucusMemberships").findOne({
      caucusId: caucus._id,
      memberType: "character",
      memberId: auth.user.character._id,
      status: "active",
    });
    if (!membership) {
      return errorResponse(403, "Only active caucus members may run for chair.");
    }

    const userDoc = await db
      .collection("users")
      .findOne({ _id: auth.user.character.userId }, { projection: { createdAt: 1 } });
    const cooldown = isInNewCharacterCooldown({
      userCreatedAt: userDoc?.createdAt ?? new Date(0),
      characterCreatedAt: auth.user.character.createdAt,
      partyJoinedAt: auth.user.character.partyJoinedAt,
      includePartyJoinedAt: false,
    });
    if (cooldown.blocked) {
      return errorResponse(
        403,
        "New characters can't run in caucus chair elections for 24 hours. Try again later."
      );
    }

    const election = await db.collection<CaucusChairElection>("caucusChairElections").findOne({
      caucusId: caucus._id,
      status: "voting",
    });
    if (!election) {
      return errorResponse(404, "No active caucus chair election found.");
    }

    // Minimum party tenure before standing for caucus chair (leadershipTenure.ts) —
    // measured on party membership, matching national/state leadership.
    const currentTurn = await getCurrentTurn(db);
    // `partyId` (canonical String(party.sequentialId)), not the raw `id` path
    // segment — "07" and "7" resolve to the same party but compare unequal.
    const tenure = getLeadershipEligibility(auth.user.character, currentTurn, partyId);
    if (!tenure.eligible) {
      return errorResponse(
        403,
        `You must be a member of this party for ${tenure.turnsRemaining} more turn${tenure.turnsRemaining === 1 ? "" : "s"} before you can run for leadership.`,
        { extra: { turnsRemaining: tenure.turnsRemaining } }
      );
    }

    const now = new Date();
    const existing = await db.collection<CaucusChairCandidate>("caucusChairCandidates").findOne({
      electionId: election._id,
      characterId: auth.user.character._id,
      status: "active",
    });

    if (parsed.data.withdraw) {
      if (!existing) {
        return errorResponse(404, "You are not currently a candidate in this election.");
      }
      await db
        .collection<CaucusChairCandidate>("caucusChairCandidates")
        .updateOne({ _id: existing._id }, { $set: { status: "withdrawn" } });
      return NextResponse.json({
        success: true,
        message: "Withdrew from the caucus chair election.",
      });
    }

    if (existing) {
      return errorResponse(409, "You are already a candidate in this election.");
    }

    await db.collection<CaucusChairCandidate>("caucusChairCandidates").insertOne({
      _id: new ObjectId(),
      electionId: election._id,
      caucusId: caucus._id,
      characterId: auth.user.character._id,
      characterName: auth.user.character.name,
      status: "active",
      enteredAt: now,
    });

    return NextResponse.json({
      success: true,
      message: "Declared your candidacy for Caucus Chair.",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
