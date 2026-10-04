import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { taxRateSchema } from "@/lib/api/schemas/settings";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { PoliticalParty } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/parties/[id]/tax — Set the national party tax rate on member fund generation
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return errorResponse(400, "Invalid country code");
    }

    // Verify authentication
    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = authResult.user;

    const parsed = await parseJsonBody(request, taxRateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const rate = parsed.data.taxRate;

    const db = await getDb();

    // Get the party
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return errorResponse(404, "Party not found");
    }

    // Verify user is the national chair, vice chair, treasurer, or admin
    const isAdmin = authUser.isAdmin;
    const isChair = party.chairId?.equals(authUser.character._id);
    const isViceChair = party.viceChairId?.equals(authUser.character._id);
    const isTreasurer = party.treasurerId?.equals(authUser.character._id);

    if (!isAdmin && !isChair && !isViceChair && !isTreasurer) {
      return errorResponse(
        403,
        "Only the party chair, vice chair, treasurer, or an admin can set the tax rate"
      );
    }

    const now = new Date();

    // Update the tax rate
    await db.collection<PoliticalParty>("politicalParties").updateOne(
      { _id: party._id },
      {
        $set: {
          nationalTaxRate: rate,
          updatedAt: now,
        },
      }
    );

    // Log the action
    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "tax_rate_changed",
      username: authUser.username,
      characterName: authUser.character.name,
      adminUsername: isAdmin ? authUser.username : undefined,
      details: `National tax rate for ${party.name} changed to ${rate}%`,
      createdAt: now,
    });

    return NextResponse.json({
      success: true,
      message: `National tax rate set to ${rate}%`,
      taxRate: rate,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
