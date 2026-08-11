import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import type {
  Character,
  ElectedOfficial,
  ElectionCandidate,
  PoliticalParty,
  StatePartyOrg,
} from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

// POST /api/settings/resign-all — Resigns the authenticated character from all held offices, candidacies, and leadership positions
// Auth: requireAuthWithCharacter
// Errors: 401, 429
export async function POST() {
  try {
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const auth = authResult.user;

    const db = await getDb();
    const charId = auth.character._id;
    const now = new Date();

    const resigned: string[] = [];

    // 1. Clear currentOffice on the character
    const char = await db.collection<Character>("characters").findOne({ _id: charId });
    if (char?.currentOffice) {
      await db
        .collection<Character>("characters")
        .updateOne({ _id: charId }, { $set: { currentOffice: null, updatedAt: now } });
      resigned.push(`Office: ${char.currentOffice.type}`);
    }

    // 2. Clear elected officials records where this character holds a seat
    const officialResult = await db.collection<ElectedOfficial>("electedOfficials").updateMany(
      { characterId: charId },
      {
        $set: { characterId: null, updatedAt: now },
        $unset: { characterName: "", party: "", electedAt: "" },
      }
    );
    if (officialResult.modifiedCount > 0) {
      resigned.push(`Elected official seats: ${officialResult.modifiedCount}`);
    }

    // 3. Clear national party leadership positions
    const partyLeaderFields = ["chairId", "viceChairId", "treasurerId"] as const;
    for (const field of partyLeaderFields) {
      const result = await db
        .collection<PoliticalParty>("politicalParties")
        .updateMany({ [field]: charId }, { $set: { [field]: null, updatedAt: now } });
      if (result.modifiedCount > 0) {
        resigned.push(`National party ${field}: ${result.modifiedCount}`);
      }
    }

    // 4. Clear state party org leadership positions
    for (const field of partyLeaderFields) {
      const result = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .updateMany({ [field]: charId }, { $set: { [field]: null, updatedAt: now } });
      if (result.modifiedCount > 0) {
        resigned.push(`State party ${field}: ${result.modifiedCount}`);
      }
    }

    // 5. Withdraw from all active election candidacies
    const candidacyResult = await db
      .collection<ElectionCandidate>("electionCandidates")
      .updateMany(
        { characterId: charId, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
    if (candidacyResult.modifiedCount > 0) {
      resigned.push(`Election candidacies withdrawn: ${candidacyResult.modifiedCount}`);
    }

    // 5b. Withdraw from all active state-party leadership candidacies
    const statePartyCandidacyResult = await db
      .collection("statePartyCandidates")
      .updateMany(
        { characterId: charId, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
    if (statePartyCandidacyResult.modifiedCount > 0) {
      resigned.push(
        `State party candidacies withdrawn: ${statePartyCandidacyResult.modifiedCount}`
      );
    }

    // 6. Clear congress leadership (speaker, majority/minority leader)
    const congressResult = await db
      .collection("congressLeaders")
      .updateMany(
        { characterId: charId },
        { $set: { characterId: null, characterName: "Vacant", updatedAt: now } }
      );
    if (congressResult.modifiedCount > 0) {
      resigned.push(`Congress leadership: ${congressResult.modifiedCount}`);
    }

    if (resigned.length === 0) {
      return NextResponse.json({
        success: true,
        message: "You don't hold any positions to resign from.",
        resigned: [],
      });
    }

    console.log(`[Settings] ${char?.name ?? "Unknown"} resigned all positions:`, resigned);

    return NextResponse.json({
      success: true,
      message: `Successfully resigned from ${resigned.length} position(s).`,
      resigned,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
