// POST /api/country/[code]/national-corporation/split
// Finance-minister-equivalent carves a sector type into a new secondary National
// Corporation (state-internal reorg; money-neutral). Spec §24.2.
// Auth: requireAuthWithCharacter + assertTreasuryAuthority
// Errors: 400, 401, 403, 409, 429
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES, type CorporationType } from "@/lib/constants/corporations";
import { assertTreasuryAuthority } from "@/lib/nationalization/authority";
import { splitOffSectorType } from "@/lib/nationalization/restructure";

const splitSchema = z.object({
  sectorType: z.string(),
  newCorpName: z.string().min(2).max(80),
});

interface RouteParams {
  params: Promise<{ code: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { code } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, splitSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!CORPORATION_TYPES.includes(parsed.data.sectorType as CorporationType)) {
      return NextResponse.json({ error: "Invalid sector type" }, { status: 400 });
    }

    const db = await getDb();

    const authorized = await assertTreasuryAuthority(db, countryId, auth.user.character._id);
    if (!authorized) {
      return NextResponse.json(
        {
          error:
            "Only the Secretary of the Treasury (or equivalent), or the head of government if that seat is vacant, may reorganize National Corporations.",
        },
        { status: 403 }
      );
    }

    const result = await splitOffSectorType(db, {
      countryId,
      sectorType: parsed.data.sectorType as CorporationType,
      newCorpName: parsed.data.newCorpName,
    });

    return NextResponse.json({
      success: true,
      newNationalCorporationId: result.newNationalCorporationId.toString(),
      sectorsMoved: result.sectorsMoved,
    });
  } catch (error) {
    if (error instanceof Error && /already owns/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && /too short/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return handleRouteError(error);
  }
}
