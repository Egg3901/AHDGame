import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { registrationBudgetSchema } from "@/lib/api/schemas/settings";
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

// POST - Set national voter-registration drive budget percentage (player
// suggestion #81). Mirrors the GOTV budget route (chair / VC / treasurer / admin).
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

    const parsed = await parseJsonBody(request, registrationBudgetSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { registrationBudgetPercent: percent } = parsed.data;

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
            "Only the national party chair, vice chair, treasurer, or an admin can set the registration budget",
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
      { registrationBudgetPercent: percent },
      now
    );

    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "registration_budget_changed",
      username: authUser.username,
      characterName: authUser.character.name,
      adminUsername: isAdmin ? authUser.username : undefined,
      details: `National voter-registration drive budget for ${party.name} set to ${percent}%`,
      createdAt: now,
    });

    return NextResponse.json({
      success: true,
      message: `Registration drive budget set to ${percent}% of revenue`,
      registrationBudgetPercent: percent,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
