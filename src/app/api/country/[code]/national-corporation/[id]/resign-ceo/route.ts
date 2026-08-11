// POST /api/country/[code]/national-corporation/[id]/resign-ceo
// The seated CEO of a National Corporation voluntarily resigns, vacating the
// seat for a fresh State-official (SoT) appointment. This is the CEO-initiated
// counterpart to remove-ceo (which is treasury-driven); it mirrors the same
// vacate mutation but is authorized to the seated CEO rather than an official.
// Auth: requireAuthWithCharacter + viewer must be the seated CEO
// Errors: 400, 401, 403, 404, 429
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { corporationQueryFromParamId } from "@/lib/api/corporations/resolveQuery";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { Corporation } from "@/lib/db/types";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";

interface RouteParams {
  params: Promise<{ code: string; id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
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

    const db = await getDb();
    const corps = db.collection<Corporation>("corporations");
    const target = await corps.findOne({ ...idQuery, countryOwnerId: countryId });
    if (!target || !isStateOwned(target)) {
      return NextResponse.json(
        { error: "National Corporation not found for this country." },
        { status: 404 }
      );
    }

    if (target.ceoVacant || !target.ceoId) {
      return NextResponse.json(
        { error: "This National Corporation has no seated CEO." },
        { status: 400 }
      );
    }

    // Only the seated CEO may resign themselves.
    if (!target.userId || target.userId.toString() !== auth.user.userId) {
      return NextResponse.json(
        { error: "Only the seated CEO of this National Corporation may resign." },
        { status: 403 }
      );
    }

    const now = new Date();

    // Vacate the seat — mirrors the treasury-driven remove-ceo flow. A NatCorp
    // seat refills via SoT appointment, not a shareholder election.
    await corps.updateOne(
      { _id: target._id },
      {
        $set: { ceoVacant: true, updatedAt: now },
        $unset: { ceoId: "", userId: "", pendingCeoCharacterId: "" },
      }
    );

    // Clear any dangling CEO votes so nothing stale carries into the next seat.
    await db.collection("corporationCeoVotes").deleteMany({ corporationId: target._id });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
