import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { User } from "@/lib/db/types";

// POST /api/auth/discord/unlink — Removes the Discord account link from the authenticated user's profile.
// Auth: requireBasicAuth
// Errors: 401, 429
export async function POST() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();

    await db.collection<User>("users").updateOne(
      { _id: new ObjectId(user.userId) },
      {
        $unset: {
          discordId: "",
          discordUsername: "",
          discordAvatar: "",
          discordLinkedAt: "",
        },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
