// POST /api/country/[code]/national-corporation/[id]/profit-split
// The seated CEO sets the share of operating profit retained in the corp
// (0–75; ≥25% always remits to the budget). Spec P6g §5.1.
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
import { clampRetentionPercent } from "@/lib/nationalization/ceoFinance";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";
import { requireSeatedCeo } from "@/lib/nationalization/ceoRouteGuard";

const schema = z.object({ retentionPercent: z.number() });

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
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
    const target = await db
      .collection<Corporation>("corporations")
      .findOne({ ...idQuery, countryOwnerId: countryId });
    if (!target || !isStateOwned(target)) {
      return NextResponse.json(
        { error: "National Corporation not found for this country." },
        { status: 404 }
      );
    }
    const ceoGate = requireSeatedCeo(target, auth.user.character._id);
    if (ceoGate) return ceoGate;

    const retentionPercent = clampRetentionPercent(parsed.data.retentionPercent);
    await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: target._id },
        { $set: { profitRetentionPercent: retentionPercent, updatedAt: new Date() } }
      );

    return NextResponse.json({ success: true, retentionPercent });
  } catch (error) {
    return handleRouteError(error);
  }
}
