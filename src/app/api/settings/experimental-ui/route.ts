import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { experimentalUiSchema } from "@/lib/api/schemas/settings";
import type { User } from "@/lib/db/types";

// PATCH /api/settings/experimental-ui — Updates the authenticated user's opt-in to experimental UI features
// Auth: requireBasicAuth
// Errors: 400, 401, 429
export async function PATCH(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const user = auth.user;

    const rateLimit = checkRateLimit(user.userId, 30, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, experimentalUiSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { enableExperimentalUI } = parsed.data;

    const db = await getDb();

    await db
      .collection<User>("users")
      .updateOne(
        { _id: new ObjectId(user.userId) },
        { $set: { enableExperimentalUI, updatedAt: new Date() } }
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
