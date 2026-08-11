import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { MAX_DIVIDEND_RATE } from "@/lib/constants/corporations";
import { isSubsidiaryCorporationsEnabled } from "@/lib/corporations/subsidiaries/featureFlag";
import { setParentDividendFloor } from "@/lib/corporations/subsidiaries/commands/setParentDividendFloor";

const bodySchema = z.object({ floorPct: z.number().min(0).max(MAX_DIVIDEND_RATE) });

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/subsidiary/dividend-floor
 * Parent CEO sets a dividend floor on the subsidiary. Auth: derived parent
 * control. Feature-gated.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rl = checkRateLimit(`subsidiary-dividend-floor:${auth.user.userId}`, 10, 60000);
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
    const subResolved = await resolveCorporation(db, id);
    if (!subResolved.ok) return subResolved.response;

    const result = await setParentDividendFloor(db, {
      sub: subResolved.corporation,
      callerUserId: new ObjectId(auth.user.userId),
      floorPct: parsed.data.floorPct,
      now: new Date(),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({
      success: true,
      parentDividendFloorPct: result.parentDividendFloorPct,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
