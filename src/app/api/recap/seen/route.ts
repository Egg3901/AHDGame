import { NextResponse } from "next/server";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireHumanSession } from "@/lib/api/requireAuth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";

const schema = z.object({ recapId: schemas.objectId });

// POST /api/recap/seen - Marks a Season Recap ("Wrapped") as viewed (one-time).
// Auth: requireHumanSession
// Errors: 400, 401, 403
export async function POST(request: Request) {
  try {
    const auth = await requireHumanSession(request);
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const userId = new ObjectId(auth.user.userId);

    // Ownership + one-time are both enforced in the filter: only the owner's own
    // still-unviewed recap matches, so a second call (or a foreign user, or a
    // bad id) simply no-ops with updated:false — never throws, never double-sets.
    const result = await db
      .collection<RetiredCharacter>("retiredCharacters")
      .updateOne(
        { _id: new ObjectId(parsed.data.recapId), userId, recapViewedAt: { $exists: false } },
        { $set: { recapViewedAt: new Date() } }
      );

    return NextResponse.json({ success: true, updated: result.modifiedCount > 0 });
  } catch (error) {
    return handleRouteError(error);
  }
}
