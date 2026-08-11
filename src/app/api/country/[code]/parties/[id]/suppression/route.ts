import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { suppressionBudgetSchema } from "@/lib/api/schemas/settings";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  isPartyTreasuryNegative,
  resetPartyBudgetSpending,
  savePartyBudgetForScope,
} from "@/lib/partyBudgetGuards";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

// POST /api/country/[code]/parties/[id]/suppression — Set the national voter suppression budget percentage and targeting
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = authResult.user;

    const parsed = await parseJsonBody(request, suppressionBudgetSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const {
      suppressionBudgetPercent: percent,
      suppressionTargetCategory,
      suppressionTargetGroup,
    } = parsed.data;

    const db = await getDb();

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    // Authorization: admin, national chair, vice chair, or national treasurer
    const isAdmin = authUser.isAdmin;
    const isChair = party.chairId?.equals(authUser.character._id);
    const isViceChair = party.viceChairId?.equals(authUser.character._id);
    const isTreasurer = party.treasurerId?.equals(authUser.character._id);

    if (!isAdmin && !isChair && !isViceChair && !isTreasurer) {
      return NextResponse.json(
        {
          error:
            "Only the national party chair, vice chair, treasurer, or an admin can set the suppression budget",
        },
        { status: 403 }
      );
    }

    if (isPartyTreasuryNegative(party.treasury)) {
      await resetPartyBudgetSpending(db, { countryId, partyId, scope: "national" });
      if (percent > 0) {
        return NextResponse.json(
          {
            error:
              "Party spending is disabled while the national treasury is negative. All party budgets were reset to 0%.",
          },
          { status: 400 }
        );
      }
    }

    const now = new Date();
    const collection = await getPartyBudgetCollection();

    await savePartyBudgetForScope(
      collection,
      { countryId, partyId, scope: "national" },
      {
        suppressionBudgetPercent: percent,
        suppressionTargetCategory: suppressionTargetCategory ?? undefined,
        suppressionTargetGroup: suppressionTargetGroup ?? undefined,
      },
      now
    );

    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "suppression_budget_changed",
      username: authUser.username,
      characterName: authUser.character.name,
      adminUsername: isAdmin ? authUser.username : undefined,
      details: `National suppression budget for ${party.name} set to ${percent}%${suppressionTargetGroup ? ` targeting ${suppressionTargetGroup}` : ""}`,
      createdAt: now,
    });

    return NextResponse.json({
      success: true,
      message: `Suppression budget set to ${percent}% of revenue`,
      suppressionBudgetPercent: percent,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
