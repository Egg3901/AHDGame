/**
 * POST /api/unions/[id]/organize — spend action points to raise a union's
 * strength. Open to every character in the union's country whether or not the
 * union has a president. Banked strength is the organizer's vote weight when
 * the presidency is open. Gated on `labourSystemMode >= "full"`.
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
import { organizeUnion } from "@/lib/unions/commands/organizeUnion";

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

    const result = await organizeUnion(db, character, union);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      strength: result.strength,
      myStrength: result.myStrength,
      electionOpen: result.electionOpen,
      actionsSpent: result.actionsSpent,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
