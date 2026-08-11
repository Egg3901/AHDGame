import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { crossCountryActionGuard } from "@/lib/api/crossCountryGuard";
import { parseJsonBody } from "@/lib/api/validate";
import { orgBuildingBudgetSchema } from "@/lib/api/schemas/settings";
import { getPartyBudgetCollection } from "@/lib/db/collections";
import { checkPartyPresence } from "@/lib/turn/partyOrg/presence";
import { ensureStatePartyOrgRow } from "@/lib/turn/partyOrg/ensureStatePartyOrgRow";
import type { StatePartyOrg, State } from "@/lib/db/types";
import {
  findPartyBySequentialId,
  getPartyIdString,
  getStatePartyOrgDocumentId,
} from "@/lib/db/partyLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isNonElectoralUsRegion } from "@/lib/constants/states";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  isPartyTreasuryNegative,
  resetPartyBudgetSpending,
  savePartyBudgetForScope,
} from "@/lib/partyBudgetGuards";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

// POST /api/country/[code]/region/[id]/party/[partyId]/org-building — Set the state org building budget percentage
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const stateId = id;

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const authUser = auth.user;

    // Party sequentialId is unique per country, so a foreign character's party
    // id collides onto the same-id party in this country. Block cross-country
    // actors (admins included) — Bug #0668.
    const crossCountry = crossCountryActionGuard(authUser.character, countryId);
    if (crossCountry) return crossCountry;

    const parsed = await parseJsonBody(request, orgBuildingBudgetSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { orgBuildingPercent: percent } = parsed.data;

    const db = await getDb();

    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const partyKey = getPartyIdString(party);
    const statePartyKey = getStatePartyOrgDocumentId(stateId, party);
    const stateParty = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: statePartyKey });

    // Authorization: admin, national chair, state chair, vice chair, or state treasurer
    const isAdmin = authUser.isAdmin;
    const isNationalChair = party.chairId?.equals(authUser.character._id);
    const isStateChair = stateParty?.chairId?.equals(authUser.character._id);
    const isStateViceChair = stateParty?.viceChairId?.equals(authUser.character._id);
    const isStateTreasurer = stateParty?.treasurerId?.equals(authUser.character._id);

    if (!isAdmin && !isNationalChair && !isStateChair && !isStateViceChair && !isStateTreasurer) {
      return NextResponse.json(
        {
          error:
            "Only the state chair, vice chair, treasurer, national chair, or an admin can set the org building budget",
        },
        { status: 403 }
      );
    }

    if (isPartyTreasuryNegative(stateParty?.treasury)) {
      await resetPartyBudgetSpending(db, {
        countryId,
        partyId: partyKey,
        scope: "state",
        stateId,
      });
      if (percent > 0) {
        return NextResponse.json(
          {
            error:
              "Party spending is disabled while the state party treasury is negative. All party budgets were reset to 0%.",
          },
          { status: 400 }
        );
      }
    }

    // Federal districts like DC host no state party organization — block the
    // budget set for every role (admins included) so no path reaches the SSOT
    // chokepoint and throws an uncaught 500.
    if (isNonElectoralUsRegion(countryId, stateId)) {
      return NextResponse.json(
        {
          error: "This region is a federal district with no state party organization.",
        },
        { status: 400 }
      );
    }

    // Organizational Foothold rule — presence is UNIVERSAL: no role (not even
    // the national chair / vice) may organize a state the party has not
    // entered. National-tier roles pay from the national PS pool, but that
    // does not exempt them from needing at least one player / elected official
    // / active NPP here. Admins bypass all checks.
    if (!isAdmin) {
      const hasPresence = await checkPartyPresence(db, stateId, partyKey);
      if (!hasPresence) {
        return NextResponse.json(
          { error: "Cannot set org building budget: party has no presence in this state" },
          { status: 400 }
        );
      }
      // Presence confirmed but no seeded row → bootstrap it at 0% via the
      // shared helper so the budget has a row to attach to.
      if (!stateParty) {
        await ensureStatePartyOrgRow(db, {
          countryId,
          stateId,
          party,
          hasPresence: true,
        });
      }
    }

    const now = new Date();
    const collection = await getPartyBudgetCollection();

    await savePartyBudgetForScope(
      collection,
      { countryId, partyId: partyKey, scope: "state", stateId },
      {
        orgBuildingPercent: percent,
      },
      now
    );

    await db.collection("adminLogs").insertOne({
      category: "system",
      action: "org_building_budget_changed",
      username: authUser.username,
      characterName: authUser.character.name,
      adminUsername: isAdmin ? authUser.username : undefined,
      details: `State org building budget for ${state.name} ${party.name} set to ${percent}%`,
      createdAt: now,
    });

    return NextResponse.json({
      success: true,
      message: `Org building budget set to ${percent}% of revenue`,
      orgBuildingPercent: percent,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
