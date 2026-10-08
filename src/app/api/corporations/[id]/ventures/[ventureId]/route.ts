import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getCurrentTurn } from "@/lib/currentTurn";
import { applyEventChoice, clampFundingPerTurn } from "@/lib/products/venture/engine";
import { PRODUCT_VENTURES, ventureDocument } from "@/lib/products/venture/store";
import type { ProductVenture } from "@/lib/products/venture/types";

interface RouteParams {
  params: Promise<{ id: string; ventureId: string }>;
}

const noStore = { "Cache-Control": "private, no-store" };
const patchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_funding"),
    fundingPerTurnAnchor: z.number().finite().positive(),
  }),
  z.object({
    action: z.literal("answer_event"),
    eventId: z.string().min(1).max(80),
    choiceId: z.string().min(1).max(80),
  }),
  z.object({ action: z.literal("cancel") }),
]);

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limit = checkRateLimit(auth.user.userId, 30, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) return errorResponse(parsed.status, parsed.error);
    const { id, ventureId } = await params;
    const db = await getDb();
    const actionBlock = await requireCorporationActionsEnabled(db);
    if (actionBlock) return actionBlock;
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const denied = requireCeo(corporation, auth.user.userId);
    if (denied) return denied;

    const collection = db.collection<ProductVenture>(PRODUCT_VENTURES);
    const venture = await collection.findOne({
      _id: ventureId,
      corporationId: corporation._id.toString(),
    });
    if (!venture) return errorResponse(404, "Product not found");
    if (venture.stage !== "development") {
      return errorResponse(409, "This product is no longer in development");
    }
    const body = parsed.data;
    const guard = {
      _id: venture._id,
      stage: "development" as const,
      rev: venture.rev ?? 0,
    };

    if (body.action === "set_funding") {
      const funding = clampFundingPerTurn(venture.targetAnchor, body.fundingPerTurnAnchor);
      const result = await collection.updateOne(
        { _id: venture._id, stage: "development" },
        { $set: { fundingPerTurnAnchor: funding }, $inc: { rev: 1 } }
      );
      if (result.matchedCount !== 1)
        return errorResponse(409, "This product is no longer in development");
      return NextResponse.json({ fundingPerTurnAnchor: funding }, { headers: noStore });
    }

    if (body.action === "cancel") {
      const result = await collection.updateOne(guard, {
        $set: { stage: "cancelled" },
        $unset: { activeKey: "" },
        $inc: { rev: 1 },
      });
      if (result.matchedCount !== 1) {
        return errorResponse(409, "The turn just processed. Try again.");
      }
      return NextResponse.json({ ok: true }, { headers: noStore });
    }

    const turn = await getCurrentTurn(db);
    const next = applyEventChoice(venture, body.eventId, body.choiceId, turn, false);
    if (!next) return errorResponse(400, "That decision is not open");
    const result = await collection.replaceOne(
      guard,
      ventureDocument({ ...next, rev: (venture.rev ?? 0) + 1 }) as ProductVenture
    );
    if (result.matchedCount !== 1) {
      return errorResponse(409, "The turn just processed. Try again.");
    }
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    return handleRouteError(error);
  }
}
