import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { partyInfluenceQueueSchema, partyInfluenceSchema } from "@/lib/api/schemas/influence";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { getDb } from "@/lib/mongodb";
import { canUseNationalPartyInfluence } from "@/lib/parties/access";
import {
  executeNationalPartyInfluenceQueue,
  type NationalPartyInfluenceQueueItem,
} from "@/lib/parties/commands/nationalInfluence";
import { getNationalPartyInfluenceView } from "@/lib/parties/queries/nationalInfluence";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

const partyInfluenceRequestSchema = z.union([partyInfluenceQueueSchema, partyInfluenceSchema]);

// GET /api/country/[code]/parties/[id]/influence - Return shared national-party NPP management options.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    if (!canUseNationalPartyInfluence(party, auth.user)) {
      return NextResponse.json(
        {
          error: `Only the ${getPartyRoleLabel(countryId, "chair")}, ${getPartyRoleLabel(countryId, "viceChair")}, or a confirmed campaigner can use party influence`,
        },
        { status: 403 }
      );
    }

    return NextResponse.json(await getNationalPartyInfluenceView(db, party, countryId));
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/country/[code]/parties/[id]/influence - Execute shared national-party NPP influence actions.
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404, 429
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { code, id: partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    if (!canUseNationalPartyInfluence(party, auth.user)) {
      return NextResponse.json(
        {
          error: `Only the ${getPartyRoleLabel(countryId, "chair")}, ${getPartyRoleLabel(countryId, "viceChair")}, or a confirmed campaigner can use party influence`,
        },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, partyInfluenceRequestSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    let queueItems: NationalPartyInfluenceQueueItem[];
    if ("queue" in parsed.data) {
      queueItems = parsed.data.queue as NationalPartyInfluenceQueueItem[];
    } else {
      queueItems = [parsed.data as NationalPartyInfluenceQueueItem];
    }

    const result = await executeNationalPartyInfluenceQueue(db, {
      party,
      actor: auth.user,
      queueItems,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (!("queue" in parsed.data)) {
      const singleResult = result.results[0];
      return NextResponse.json({
        success: singleResult.success,
        outcome: singleResult.outcome,
        message: singleResult.message,
        party: result.party,
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
