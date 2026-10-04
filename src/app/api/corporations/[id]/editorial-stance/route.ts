import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { Corporation, GameConfig } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const stanceSchema = z.object({
  economic: z.number().int().min(-5).max(5),
  social: z.number().int().min(-5).max(5),
});

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limited = checkRateLimit(auth.user.userId, 5, 60_000);
    if (!limited.ok) return rateLimitResponse(limited.retryAfter);

    const parsed = await parseJsonBody(request, stanceSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { id } = await params;
    const db = await getDb();
    const actionBlock = await requireCorporationActionsEnabled(db);
    if (actionBlock) return actionBlock;
    const config = await db
      .collection<GameConfig>("gameConfig")
      .findOne({ _id: "default" }, { projection: { mediaEditorialEnabled: 1 } });
    if (config?.mediaEditorialEnabled !== true) {
      return errorResponse(404, "Editorial stance is unavailable");
    }
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const denied = requireCeo(corporation, auth.user.userId);
    if (denied) return denied;

    const mediaSector = await db
      .collection("corporateSectors")
      .findOne({ corporationId: corporation._id, sectorType: "media" }, { projection: { _id: 1 } });
    if (!mediaSector) {
      return errorResponse(403, "Only a media publisher can set an editorial stance");
    }

    const stance = { economic: parsed.data.economic, social: parsed.data.social };
    const updated = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: corporation._id, userId: new ObjectId(auth.user.userId), ceoVacant: { $ne: true } },
        { $set: { editorialStance: stance } }
      );
    if (updated.modifiedCount !== 1 && updated.matchedCount !== 1) {
      return errorResponse(409, "Corporation ownership changed");
    }
    return NextResponse.json({ editorialStance: stance });
  } catch (error) {
    return handleRouteError(error);
  }
}
