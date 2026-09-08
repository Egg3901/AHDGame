import { NextRequest, NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { badRequest, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getDb } from "@/lib/mongodb";
import type { State } from "@/lib/db/types";
import { targetKey, purchaseSchema } from "@/lib/campaignTargeting/schema";
import { quoteStandingAds, purchaseStandingAds } from "@/lib/campaignTargeting/standingCommands";

// Auth: requireAuthWithCharacter. A standing action requires no active race.
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const rate = checkRateLimit(`targeted-ads-preview:${auth.user.userId}`, 30, 60_000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);
    const parsed = targetKey
      .optional()
      .safeParse(request.nextUrl.searchParams.get("stateId") ?? undefined);
    if (!parsed.success) throw badRequest("Invalid region");
    const db = await getDb();
    const character = auth.user.character;
    const regions = await db
      .collection<State>("states")
      .find({ countryId: character.countryId }, { projection: { _id: 1, name: 1 } })
      .toArray();
    const stateId = parsed.data ?? character.homeState ?? regions[0]?._id;
    if (!stateId) throw badRequest("No regions available");
    const quote = await quoteStandingAds(db, character, stateId);
    return NextResponse.json(
      { ...quote, regions: regions.map((region) => ({ id: region._id, name: region.name })) },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}

// Auth: requireAuthWithCharacter. Atomic personal spend and standing exposure write.
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const rate = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);
    const parsed = await parseJsonBody(request, purchaseSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const result = await purchaseStandingAds(
      await getDb(),
      auth.user.character,
      auth.user.character,
      parsed.data
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
