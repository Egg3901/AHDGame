// POST /api/prospecting/corporation - Launch a corporation-funded geological survey.
// Auth: requireBasicAuth + requireCeo of the target corporation
// Errors: 400, 401, 402, 403, 404, 409, 429

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCurrentTurn } from "@/lib/currentTurn";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { isProspectingEnabled } from "@/lib/extraction/featureFlag";
import { launchCorpProspect } from "@/lib/extraction/commands/launchCorpProspect";
import { corpProspectSchema } from "@/lib/api/schemas/prospecting";

export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rate = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!rate.ok) return rateLimitResponse(rate.retryAfter);

    if (!(await isProspectingEnabled())) {
      return NextResponse.json({ error: "Resource prospecting is not enabled." }, { status: 403 });
    }

    const parsed = await parseJsonBody(request, corpProspectSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { corporationId, stateId, resource } = parsed.data;

    const db = await getDb();

    const pausedGuard = await requireCorporationActionsEnabled(db);
    if (pausedGuard) return pausedGuard;

    const resolved = await resolveCorporation(db, corporationId);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoErr = requireCeo(corporation, auth.user.userId);
    if (ceoErr) return ceoErr;

    const turn = await getCurrentTurn(db);
    const now = new Date();
    const result = await launchCorpProspect(db, corporation, { stateId, resource }, turn, now);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      survey: { ...result.survey, _id: result.survey._id.toString() },
      costs: result.costs,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
