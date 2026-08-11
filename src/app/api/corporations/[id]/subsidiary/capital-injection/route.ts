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
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { isSubsidiaryCorporationsEnabled } from "@/lib/corporations/subsidiaries/featureFlag";
import { capitalInjection } from "@/lib/corporations/subsidiaries/commands/capitalInjection";

const bodySchema = z.object({ amount: z.number().positive() });

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/subsidiary/capital-injection
 * Parent CEO injects capital into the subsidiary (amount in parent local
 * currency). Auth: derived parent control. Feature-gated.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rl = checkRateLimit(`subsidiary-capital-injection:${auth.user.userId}`, 10, 60000);
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

    const turn = await getCurrentTurn(db).catch(() => 0);
    const result = await capitalInjection(db, {
      sub: subResolved.corporation,
      callerUserId: new ObjectId(auth.user.userId),
      amount: parsed.data.amount,
      turn,
      now: new Date(),
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    return NextResponse.json({
      success: true,
      debitedParent: result.debitedParent,
      creditedSubsidiary: result.creditedSubsidiary,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
