/**
 * PATCH /api/unions/[id]/services: the union president switches the service
 * slate on/off. Gated on `labourSystemMode >= "full"`.
 *
 * Unknown service ids are dropped, not stored (`normalizeServiceIds`), so a
 * stale or hand-edited request body can never widen the effect beyond the
 * four defined tiers. The response echoes the normalized slate and its
 * projected treasury cost per turn.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { parseJsonBody } from "@/lib/api/validate";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { isLabourFullMode } from "@/lib/labour/featureFlag";
import { setUnionServices } from "@/lib/unions/commands/unionActions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const servicesSchema = z.object({
  activeServices: z.array(z.string()).max(32, "Too many service ids."),
});

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    if (!(await isLabourFullMode())) {
      return NextResponse.json({ error: "Player-run unions are not enabled." }, { status: 403 });
    }

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, servicesSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { id } = await params;
    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const result = await setUnionServices(db, character, id, parsed.data.activeServices);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handleRouteError(error);
  }
}
