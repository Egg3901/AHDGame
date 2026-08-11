// POST /api/country/[code]/national-corporation/[id]/invest
// The seated CEO sets the corp-wide modernization (R&D) budget PER TURN. Each
// turn the SOE phase debits this from liquidCapital (when affordable) and adds
// it to rdScore — a sustained investment, not a one-time lump sum. `amount` is
// the per-turn budget in the corp's local currency (0 disables recurring R&D).
// Capacity reuses /corporations/[id]/sectors/[sectorId]/growth and production
// reuses /corporations/[id]/sectors/[sectorId]/policy. Spec P6g §4.
// Auth: requireAuthWithCharacter + seated-CEO check. Errors: 400, 401, 403, 404, 429
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";
import { requireSeatedCeo } from "@/lib/nationalization/ceoRouteGuard";

// `amount` is the per-turn R&D budget to set (0 disables recurring spend).
const schema = z.object({ kind: z.literal("rd"), amount: z.number().min(0) });

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const idQuery = corporationQueryFromParamId(id);
    if (!idQuery) {
      return NextResponse.json({ error: "Invalid corporation ID" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const corps = db.collection<Corporation>("corporations");
    const target = await corps.findOne({ ...idQuery, countryOwnerId: countryId });
    if (!target || !isStateOwned(target)) {
      return NextResponse.json(
        { error: "National Corporation not found for this country." },
        { status: 404 }
      );
    }
    const ceoGate = requireSeatedCeo(target, auth.user.character._id);
    if (ceoGate) return ceoGate;

    const rdBudgetPerTurn = Math.round(parsed.data.amount);
    const now = new Date();

    // Set the per-turn modernization budget; the SOE turn phase spends it (when
    // affordable) and accrues rdScore. No immediate debit here.
    await corps.updateOne({ _id: target._id }, { $set: { rdBudgetPerTurn, updatedAt: now } });
    return NextResponse.json({ success: true, kind: "rd", rdBudgetPerTurn });
  } catch (error) {
    return handleRouteError(error);
  }
}
