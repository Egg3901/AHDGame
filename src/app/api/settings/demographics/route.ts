import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { characterDemographicsSchema } from "@/lib/api/schemas/settings";
import type { Character } from "@/lib/db/types";

// PATCH /api/settings/demographics — Updates the authenticated character's demographic profile fields
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 429
export async function PATCH(request: Request) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, characterDemographicsSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    await db
      .collection<Character>("characters")
      .updateOne(
        { _id: auth.user.character._id },
        { $set: { demographics: parsed.data, updatedAt: new Date() } }
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
