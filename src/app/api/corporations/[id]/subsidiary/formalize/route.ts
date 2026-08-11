import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import type { Corporation } from "@/lib/db/types";
import { isSubsidiaryCorporationsEnabled } from "@/lib/corporations/subsidiaries/featureFlag";
import { formalizeSubsidiary } from "@/lib/corporations/subsidiaries/commands/formalizeSubsidiary";

const bodySchema = z.object({ parentCorporationId: schemas.objectId });

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/subsidiary/formalize
 * Formalize the corp at `[id]` (target) as a managed subsidiary of the corp in
 * `parentCorporationId`. Auth: parent CEO. Feature-gated.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rl = checkRateLimit(`subsidiary-formalize:${auth.user.userId}`, 10, 60000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;
    if (!(await isSubsidiaryCorporationsEnabled())) {
      return NextResponse.json(
        { error: "Subsidiary corporations are not enabled." },
        { status: 403 }
      );
    }

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { id } = await params;
    const targetResolved = await resolveCorporation(db, id);
    if (!targetResolved.ok) return targetResolved.response;

    const parent = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(parsed.data.parentCorporationId) });
    if (!parent)
      return NextResponse.json({ error: "Parent corporation not found." }, { status: 404 });

    const turn = await getCurrentTurn(db).catch(() => 0);
    const result = await formalizeSubsidiary(db, {
      parent,
      target: targetResolved.corporation,
      callerUserId: new ObjectId(auth.user.userId),
      turn,
      now: new Date(),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({
      success: true,
      subsidiaryFormalizedAtTurn: result.subsidiaryFormalizedAtTurn,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
