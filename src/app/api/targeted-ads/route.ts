import { NextRequest, NextResponse } from "next/server";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { badRequest, handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getDb } from "@/lib/mongodb";
import { targetKey, purchaseSchema, quoteCountSchema } from "@/lib/campaignTargeting/schema";
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
    const count = quoteCountSchema.safeParse(request.nextUrl.searchParams.get("count") ?? 1);
    if (!count.success) throw badRequest("Invalid action count");
    const stateId = parsed.data ?? character.homeState;
    const quote = await quoteStandingAds(db, character, stateId, count.data);
    return NextResponse.json(quote, { headers: { "Cache-Control": "private, no-store" } });
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
