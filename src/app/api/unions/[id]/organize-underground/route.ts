/**
 * POST /api/unions/[id]/organize-underground — spend action points to build
 * a suspended union's shadow pool. Open to every character in the union's
 * country while the ban holds. Body: { mode: "quiet" | "mass" }.
 * Gated on `labourSystemMode >= "full"`.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import type { Union } from "@/lib/db/types";
import { organizeUnderground } from "@/lib/unions/commands/organizeUnderground";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid union ID" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, z.object({ mode: z.enum(["quiet", "mass"]) }));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Choose how to organize: mode must be "quiet" or "mass".' },
        { status: parsed.status }
      );
    }
    const body = parsed.data;

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const union = await db.collection<Union>("unions").findOne({ _id: new ObjectId(id) });
    if (!union) {
      return NextResponse.json({ error: "Union not found" }, { status: 404 });
    }

    const result = await organizeUnderground(db, character, union, body.mode);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      undergroundStrength: result.undergroundStrength,
      status: result.statusLabel,
      heatText: result.heatText,
      strengthGain: result.strengthGain,
      actionsSpent: result.actionsSpent,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
