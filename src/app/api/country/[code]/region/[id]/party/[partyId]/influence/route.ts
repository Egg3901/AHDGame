import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { crossCountryActionGuard } from "@/lib/api/crossCountryGuard";
import { parseJsonBody } from "@/lib/api/validate";
import { partyInfluenceSchema } from "@/lib/api/schemas/influence";
import type { StatePartyOrg, InfluenceType } from "@/lib/db/types";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import {
  NPP_MANAGEMENT_AP_COST,
  nppActionPointCap,
  nppActionPointRegen,
  nppManagementFundCost,
  nppTreasuryCurrency,
} from "@/lib/npp/actionPoints";
import { resolvePartyTier } from "@/lib/parties/partyTier";
import {
  executeStatePartyInfluence,
  getStatePartyInfluenceOptions,
  INFLUENCE_ACTIONS,
} from "@/lib/influence";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

interface RouteParams {
  params: Promise<{ code: string; id: string; partyId: string }>;
}

const STATE_PARTY_MANAGEMENT_ACTIONS: InfluenceType[] = [
  "boost_favorability",
  "boost_influence",
  "boost_loyalty",
  "reduce_stubbornness",
];

// GET /api/country/[code]/region/[id]/party/[partyId]/influence - Return state-party NPP management options.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id: stateId, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    // Cross-country guard (Bug #0668): party sequentialId is unique per
    // country, so a foreign actor's party id collides onto the same-id local
    // party. Block cross-country actors (admins included).
    const crossCountry = crossCountryActionGuard(authResult.user.character, countryId);
    if (crossCountry) return crossCountry;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const statePartyOrg = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: `${stateId.toUpperCase()}_${partyId}` });
    if (!statePartyOrg) {
      return NextResponse.json({ error: "State party not found" }, { status: 404 });
    }

    const characterId = authResult.user.character._id;
    const isChair = statePartyOrg.chairId?.equals(characterId);
    const isViceChair = statePartyOrg.viceChairId?.equals(characterId);
    const isAdmin = authResult.user.isAdmin;

    if (!isChair && !isViceChair && !isAdmin) {
      return NextResponse.json(
        { error: "Only the State Party Chair or Vice Chair can use NPP management" },
        { status: 403 }
      );
    }

    const options = await getStatePartyInfluenceOptions(
      statePartyOrg,
      party,
      isChair || isViceChair
    );
    // NPP work spends a flat 1 AP per management action from the state pool.
    const apTier = resolvePartyTier(party);
    const apCap = nppActionPointCap("state", apTier);
    const availableAp = statePartyOrg.nppActionPoints ?? apCap;

    const currency = nppTreasuryCurrency(countryId);
    const actions = STATE_PARTY_MANAGEMENT_ACTIONS.map((type) => {
      const config = INFLUENCE_ACTIONS[type];
      const fundCost = nppManagementFundCost(type, currency);
      let available = true;
      let unavailableReason: string | undefined;

      if (availableAp < NPP_MANAGEMENT_AP_COST) {
        available = false;
        unavailableReason = "Not enough Action Points";
      } else if ((statePartyOrg.treasury ?? 0) < fundCost) {
        available = false;
        unavailableReason = "Not enough party treasury funds";
      }

      return {
        type: config.type,
        name: config.name,
        description: config.description,
        actionCost: NPP_MANAGEMENT_AP_COST,
        baseFundCost: fundCost,
        baseChance: config.baseChance,
        available,
        unavailableReason,
      };
    });

    return NextResponse.json({
      partyId,
      partyName: party.name,
      stateId: statePartyOrg.stateId,
      politicalStrength: statePartyOrg.politicalStrength || 0,
      treasury: statePartyOrg.treasury,
      nppActionPoints: availableAp,
      nppActionPointCap: apCap,
      nppActionPointRegen: nppActionPointRegen("state", apTier),
      actions,
      npps: options.nppsInState,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/country/[code]/region/[id]/party/[partyId]/influence - Execute state-party NPP management actions.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: stateId, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    // Cross-country guard (Bug #0668): party sequentialId is unique per
    // country, so a foreign actor's party id collides onto the same-id local
    // party. Block cross-country actors (admins included).
    const crossCountry = crossCountryActionGuard(authResult.user.character, countryId);
    if (crossCountry) return crossCountry;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, partyInfluenceSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    if (!STATE_PARTY_MANAGEMENT_ACTIONS.includes(parsed.data.influenceType)) {
      return NextResponse.json(
        {
          error: `${INFLUENCE_ACTIONS[parsed.data.influenceType].name} is not available in State NPP Management.`,
        },
        { status: 400 }
      );
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    const result = await executeStatePartyInfluence({
      partyId,
      partyObjectId: party._id,
      countryId: party.countryId,
      stateId: stateId.toUpperCase(),
      nppId: new ObjectId(parsed.data.nppId),
      influenceType: parsed.data.influenceType,
      fundAmount: Math.max(0, Math.floor(parsed.data.fundAmount || 0)),
      actorCharacterId: authResult.user.character._id,
      context: parsed.data.context || {},
    });

    const updatedStateParty = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .findOne({ _id: `${stateId.toUpperCase()}_${partyId}` });

    return NextResponse.json({
      success: result.success,
      outcome: result.outcome,
      message: result.error || result.message,
      party: updatedStateParty
        ? {
            politicalStrength: updatedStateParty.politicalStrength || 0,
            treasury: updatedStateParty.treasury,
          }
        : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
