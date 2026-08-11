import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { clampPricingPosture } from "@/lib/market/clearing";
import { isMarketSystemMode, marketAtLeast, getMarketSystemMode } from "@/lib/market/featureFlag";
import type { CorporateSector } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { setSectorPricingSchema } from "@/lib/api/schemas/corporations";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

/**
 * POST /api/corporations/[id]/sectors/[sectorId]/pricing
 * Set the CEO's pricing posture for a sector (marketSystemMode >= "clearing").
 * Posture is the posted price relative to market, −20%…+20%; null reverts to
 * automatic positioning. CEO only. No cooldown — repricing is a market move,
 * not a construction project.
 */
export async function setSectorPricing(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const mode = await getMarketSystemMode();
    if (!isMarketSystemMode(mode) || !marketAtLeast(mode, "clearing")) {
      return NextResponse.json(
        { error: "Market clearing is not enabled on this world" },
        { status: 400 }
      );
    }

    const { id, sectorId } = await params;
    const parsed = await parseJsonBody(request, setSectorPricingSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { pricingPosture } = parsed.data;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: new ObjectId(sectorId), corporationId: corporation._id });

    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    const clamped = pricingPosture == null ? null : clampPricingPosture(pricingPosture);

    await db
      .collection<CorporateSector>("corporateSectors")
      .updateOne({ _id: sector._id }, { $set: { pricingPosture: clamped, updatedAt: new Date() } });

    return NextResponse.json({ success: true, pricingPosture: clamped });
  } catch (error) {
    return handleRouteError(error);
  }
}
