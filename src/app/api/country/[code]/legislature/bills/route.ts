/**
 * GET /api/country/[code]/legislature/bills — National legislature bills by country.
 * POST /api/country/[code]/legislature/bills — Propose a bill.
 *
 * Consolidates the former per-country routes:
 *   /api/legislature/uk/bills, /api/legislature/ca/bills, /api/legislature/de/bills
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser() in GET
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { parseJsonBody } from "@/lib/api/validate";
import { proposeBillSchema } from "@/lib/api/schemas/congress";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { proposeNationalBill } from "@/lib/legislature/commands/proposeNationalBill";
import { listNationalLegislatureBills } from "@/lib/legislature/queries/nationalBillQueries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { checkLegislationFreeze } from "@/lib/api/parliamentaryFreeze";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";
import { getGameState } from "@/lib/gameState";
import { loadRuntimeCountryOffices } from "@/lib/countries/runtimeOffices";
import { mayRuleByDecree } from "@/lib/singleplayerHeadOfState";

// GET /api/country/[code]/legislature/bills — List national legislature bills for a country.
// Auth: public
// Errors: 404
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }
    const db = await getDb();
    const gameState = await getGameState(db);
    const { config } = await loadRuntimeCountryOffices(db, countryId, gameState?.preset);
    if (!config) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const chamber = searchParams.get("chamber") ?? config.legislature.lowerChamber.key;
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const authUser = await getAuthUser().catch(() => null);
    const response = await listNationalLegislatureBills(db, {
      countryId,
      chamber,
      page,
      authUser,
    });

    return NextResponse.json(response);
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/country/[code]/legislature/bills — Propose a national legislature bill.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }
    const db = await getDb();
    const gameState = await getGameState(db);
    const preset = gameState?.preset;
    const { config } = await loadRuntimeCountryOffices(db, countryId, preset);
    if (!config) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    if (
      config.legislature.lowerChamber.elected === false ||
      config.legislature.lowerChamber.seats < 1
    ) {
      return NextResponse.json(
        { error: "This legislature is dissolved and cannot receive bills." },
        { status: 409 }
      );
    }

    const lowerKey = config.legislature.lowerChamber.key;
    const upperKey = config.legislature.upperChamber?.key;
    // Bill-active bicameral legislatures (JP/NG) let the upper chamber originate
    // bills too; UK Lords / DE Bundesrat are `bicameral: false` and stay lower-only
    // (#912 — NG senators were rejected as ineligible proposers).
    // Era-aware: TR 1953 is unicameral (no Senato).
    const allowedOriginKeys: string[] =
      config.legislature.bicameral && upperKey ? [lowerKey, upperKey] : [lowerKey];
    const allowedOriginOfficeTypes = allowedOriginKeys.map((k) =>
      getOfficeTypeForChamber(countryId, k, preset, config)
    );

    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const character = await getCharacterByUserId(db, auth.user.userId);
    const official =
      character == null
        ? null
        : await db.collection("electedOfficials").findOne({
            characterId: character._id,
            officeType: { $in: allowedOriginOfficeTypes },
            countryId,
          });
    const usingSovereignOverride = character ? mayRuleByDecree(character, countryId) : false;

    if (!(auth.user.isAdmin === true && !official) && !usingSovereignOverride) {
      const freezeCheck = await checkLegislationFreeze(countryId);
      if (!freezeCheck.ok) return freezeCheck.response;
    }

    const parsed = await parseJsonBody(request, proposeBillSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!allowedOriginKeys.includes(parsed.data.chamber)) {
      return NextResponse.json(
        { error: `Invalid chamber for ${countryId} legislature.` },
        { status: 400 }
      );
    }

    const result = await proposeNationalBill(db, countryId, auth.user, parsed.data);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return handleRouteError(error);
  }
}
