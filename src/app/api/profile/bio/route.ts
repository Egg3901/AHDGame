import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { profileBioSchema } from "@/lib/api/schemas/settings";

// PATCH /api/profile/bio — Updates the authenticated character's profile bio text
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function PATCH(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, profileBioSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const trimmed = parsed.data.bio;

    const db = await getDb();
    const result = await db
      .collection("characters")
      .updateOne(
        { userId: new ObjectId(user.userId) },
        { $set: { bio: trimmed, updatedAt: new Date() } }
      );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, bio: trimmed });
  } catch (error) {
    return handleRouteError(error);
  }
}
