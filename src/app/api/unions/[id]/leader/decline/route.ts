/**
 * POST /api/unions/[id]/leader/decline — decline a pending union presidency offer.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import type { Union } from "@/lib/db/types";
import { declineUnionLeadership } from "@/lib/unions/commands/declineUnionLeadership";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isLabourFullMode())) {
      return errorResponse(403, "Player-run unions are not enabled.");
    }

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return errorResponse(400, "Invalid union ID");
    }

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return errorResponse(404, "Character not found");
    }

    const union = await db.collection<Union>("unions").findOne({ _id: new ObjectId(id) });
    if (!union) {
      return errorResponse(404, "Union not found");
    }

    const result = await declineUnionLeadership(db, character, union);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
