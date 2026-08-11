import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { themeSchema } from "@/lib/api/schemas/settings";
import { emit } from "@/lib/events";
import type { User } from "@/lib/db/types";

// PATCH /api/settings/theme — Updates the authenticated user's UI theme preference
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function PATCH(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, themeSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { theme } = parsed.data;

    const db = await getDb();
    await db
      .collection<User>("users")
      .updateOne(
        { _id: new ObjectId(auth.user.userId) },
        { $set: { theme, updatedAt: new Date() } }
      );

    // Notify SSE listeners. In-process only — Vercel multi-instance deployments
    // may not deliver this to all connected clients. Clients should poll as fallback.
    emit({
      type: "theme_changed",
      payload: { theme, userId: auth.user.userId },
      timestamp: new Date().toISOString(),
      userId: auth.user.userId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
