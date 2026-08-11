// POST /api/country/[code]/national-corporation/[id]/mandate
// Finance-minister-equivalent (fallback head of government) sets a National
// Corporation's public-service posture: corp-wide default, a per-sector override,
// or clearing a sector back to the default. Spec §11.4 / §24.
// Auth: requireAuthWithCharacter + assertTreasuryAuthority
// Errors: 400, 401, 403, 404, 429
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types";
import { assertTreasuryAuthority } from "@/lib/nationalization/authority";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import {
  setCorpMandate,
  setSectorMandate,
  clearSectorMandate,
} from "@/lib/nationalization/mandateControl";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";

const mandateSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("corp"),
    priceControlled: z.boolean(),
    employmentGuaranteed: z.boolean(),
  }),
  z.object({
    scope: z.literal("sector"),
    sectorId: z.string().length(24),
    priceControlled: z.boolean(),
    employmentGuaranteed: z.boolean(),
  }),
  z.object({
    scope: z.literal("sectorClear"),
    sectorId: z.string().length(24),
  }),
]);

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

    const parsed = await parseJsonBody(request, mandateSchema);
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
    const corpId = target._id;

    // The seated CEO runs the corporation and may set its mandates, as may the
    // finance minister / head of government (treasury authority).
    const viewerIsCeo =
      !target.ceoVacant && target.ceoId != null && target.ceoId.equals(auth.user.character._id);
    const authorized =
      viewerIsCeo || (await assertTreasuryAuthority(db, countryId, auth.user.character._id));
    if (!authorized) {
      return NextResponse.json(
        {
          error:
            "Only the seated CEO, the Secretary of the Treasury (or equivalent), or the head of government may set a National Corporation mandate.",
        },
        { status: 403 }
      );
    }

    const body = parsed.data;
    if (body.scope === "corp") {
      await setCorpMandate(db, corpId, {
        priceControlled: body.priceControlled,
        employmentGuaranteed: body.employmentGuaranteed,
      });
    } else if (body.scope === "sector") {
      if (!ObjectId.isValid(body.sectorId)) {
        return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
      }
      await setSectorMandate(db, corpId, new ObjectId(body.sectorId), {
        priceControlled: body.priceControlled,
        employmentGuaranteed: body.employmentGuaranteed,
      });
    } else {
      if (!ObjectId.isValid(body.sectorId)) {
        return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
      }
      await clearSectorMandate(db, corpId, new ObjectId(body.sectorId));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    // Engine throws "Sector not found..." for cross-corp tampering → 404.
    if (error instanceof Error && /sector not found/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return handleRouteError(error);
  }
}
