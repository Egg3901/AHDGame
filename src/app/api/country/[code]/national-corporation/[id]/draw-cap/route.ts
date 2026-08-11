// POST /api/country/[code]/national-corporation/[id]/draw-cap
// The finance-minister-equivalent sets the CEO's per-turn treasury-draw cap
// (local currency; 0 freezes draws). Spec P6g §5.2.
// Auth: requireAuthWithCharacter + assertTreasuryAuthority. Errors: 400, 401, 403, 404, 429
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
import { assertTreasuryAuthority } from "@/lib/nationalization/authority";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";

const schema = z.object({ cap: z.number().min(0) });

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
    const authorized = await assertTreasuryAuthority(db, countryId, auth.user.character._id);
    if (!authorized) {
      return NextResponse.json(
        {
          error:
            "Only the Secretary of the Treasury (or equivalent), or the head of government if that seat is vacant, may set the draw cap.",
        },
        { status: 403 }
      );
    }

    const target = await db
      .collection<Corporation>("corporations")
      .findOne({ ...idQuery, countryOwnerId: countryId });
    if (!target || !isStateOwned(target)) {
      return NextResponse.json(
        { error: "National Corporation not found for this country." },
        { status: 404 }
      );
    }

    const treasuryDrawCap = Math.max(0, Math.round(parsed.data.cap));
    await db
      .collection<Corporation>("corporations")
      .updateOne({ _id: target._id }, { $set: { treasuryDrawCap, updatedAt: new Date() } });

    return NextResponse.json({ success: true, treasuryDrawCap });
  } catch (error) {
    return handleRouteError(error);
  }
}
