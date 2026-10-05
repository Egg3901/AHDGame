import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { clampPricingPosture } from "@/lib/market/clearing";
import { isMarketSystemMode, marketAtLeast, getMarketSystemMode } from "@/lib/market/featureFlag";
import type { CorporateSector, GameConfig } from "@/lib/db/types";
import { supportsCostPlusPricing, validCostPlusBasis } from "@/lib/market/costPlusPricing/rules";
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
      return errorResponse(400, "Market clearing is not enabled on this world");
    }

    const { id, sectorId } = await params;
    const parsed = await parseJsonBody(request, setSectorPricingSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const { pricingPosture, pricingMode } = parsed.data;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!ObjectId.isValid(sectorId)) {
      return errorResponse(400, "Invalid sector ID");
    }

    const config =
      pricingMode === "costPlus"
        ? await db
            .collection<GameConfig>("gameConfig")
            .findOne({ _id: "default" }, { projection: { explicitPlantCostsEnabled: 1 } })
        : null;

    const sector = await db.collection<CorporateSector>("corporateSectors").findOne(
      { _id: new ObjectId(sectorId), corporationId: corporation._id },
      {
        projection:
          config?.explicitPlantCostsEnabled === true
            ? {}
            : { pricingMode: 0, costPlusCostBasis: 0 },
      }
    );

    if (!sector) {
      return errorResponse(404, "Sector not found");
    }

    if (pricingMode === "costPlus") {
      if (
        config?.explicitPlantCostsEnabled !== true ||
        !marketAtLeast(mode, "plants") ||
        !supportsCostPlusPricing(sector.sectorType)
      ) {
        return errorResponse(400, "Cost-plus pricing is not available for this sector");
      }
      if (!validCostPlusBasis(sector.costPlusCostBasis)) {
        return errorResponse(
          400,
          "Cost-plus pricing needs a producing turn with recorded operating costs"
        );
      }
      if (pricingPosture === null) {
        return errorResponse(400, "Choose a markup for cost-plus pricing");
      }
    }

    const clamped = pricingPosture == null ? null : clampPricingPosture(pricingPosture);

    await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: sector._id, corporationId: corporation._id },
      {
        $set: {
          pricingPosture: clamped,
          ...(pricingMode !== undefined ? { pricingMode } : {}),
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      success: true,
      pricingPosture: clamped,
      ...(pricingMode !== undefined ? { pricingMode } : {}),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
