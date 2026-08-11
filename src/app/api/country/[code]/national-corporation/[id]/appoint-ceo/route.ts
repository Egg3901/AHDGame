// POST /api/country/[code]/national-corporation/[id]/appoint-ceo
// Finance-minister-equivalent (Secretary of the Treasury / Chancellor / etc.,
// fallback head of government) nominates a CEO for one of the country's National
// Corporations. The nominee takes the seat via the existing
// POST /api/corporations/[id]/ceo/accept flow. Spec §24.3.
// Auth: requireAuthWithCharacter + assertTreasuryAuthority
// Errors: 400, 401, 403, 404, 409, 429
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { createNotification } from "@/lib/notifications";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Character, Corporation } from "@/lib/db/types";
import { assertTreasuryAuthority } from "@/lib/nationalization/authority";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";

const appointSchema = z.object({ nomineeCharacterId: z.string().length(24) });

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

    const parsed = await parseJsonBody(request, appointSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    if (!ObjectId.isValid(parsed.data.nomineeCharacterId)) {
      return NextResponse.json({ error: "Invalid nominee ID" }, { status: 400 });
    }
    const nomineeId = new ObjectId(parsed.data.nomineeCharacterId);

    const db = await getDb();

    // Authority: seated finance minister, or head of government if vacant.
    const authorized = await assertTreasuryAuthority(db, countryId, auth.user.character._id);
    if (!authorized) {
      return NextResponse.json(
        {
          error:
            "Only the Secretary of the Treasury (or equivalent), or the head of government if that seat is vacant, may appoint a National Corporation CEO.",
        },
        { status: 403 }
      );
    }

    const corps = db.collection<Corporation>("corporations");
    const target = await corps.findOne({ ...idQuery, countryOwnerId: countryId });
    if (!target || !isStateOwned(target)) {
      return NextResponse.json(
        { error: "National Corporation not found for this country." },
        { status: 404 }
      );
    }

    // Nominee must exist and reside in this country (country-wide appointment).
    const nominee = await db.collection<Character>("characters").findOne({ _id: nomineeId });
    if (!nominee) {
      return NextResponse.json({ error: "Nominee not found" }, { status: 404 });
    }
    if (nominee.countryId !== countryId) {
      return NextResponse.json(
        { error: "The nominee must reside in this country." },
        { status: 400 }
      );
    }

    // Eligibility: nominee must not currently be CEO of any corporation
    // (player or national) — the same rule the accept route enforces.
    const existingCeo = await corps.findOne({ ceoId: nomineeId, ceoVacant: { $ne: true } });
    if (existingCeo) {
      return NextResponse.json(
        { error: `${nominee.name} is already CEO of ${existingCeo.name}.` },
        { status: 409 }
      );
    }

    const now = new Date();
    await corps.updateOne(
      { _id: target._id },
      { $set: { pendingCeoCharacterId: nomineeId, updatedAt: now } }
    );

    if (nominee.userId) {
      await createNotification({
        userId: nominee.userId,
        type: "ceo_vote_offer",
        title: "National Corporation CEO offer",
        message: `You have been nominated as CEO of ${target.name}. Accept to take the seat.`,
        metadata: {
          corporationId: target._id.toString(),
          corporationName: target.name,
        },
      });
    }

    return NextResponse.json({ success: true, pendingCeoCharacterId: nomineeId.toString() });
  } catch (error) {
    return handleRouteError(error);
  }
}
