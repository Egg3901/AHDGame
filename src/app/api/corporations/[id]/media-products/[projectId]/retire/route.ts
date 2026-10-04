import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { marketAtLeast, getMarketSystemMode } from "@/lib/market/featureFlag";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { MEDIA_PRODUCT_PROJECTS, type MediaProductProject } from "@/lib/products/mediaProduct";

interface RouteParams {
  params: Promise<{ id: string; projectId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const limit = checkRateLimit(auth.user.userId, 20, 60_000);
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);
    const { id, projectId } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const corporation = resolved.corporation;
    const ceoError = requireCeo(corporation, auth.user.userId);
    if (ceoError) return ceoError;
    const config = await db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          marketSystemMode: 1,
          mediaOperatingModelsEnabled: 1,
          mediaProductSlatesEnabled: 1,
          brandLoyaltyEnabled: 1,
          brandLoyaltySliceEnabled: 1,
          qualityPremiumPricingEnabled: 1,
        },
      }
    );
    if (
      config?.mediaProductSlatesEnabled !== true ||
      config.mediaOperatingModelsEnabled !== true ||
      config.brandLoyaltyEnabled !== true ||
      config.brandLoyaltySliceEnabled !== true ||
      config.qualityPremiumPricingEnabled !== true ||
      !marketAtLeast(await getMarketSystemMode(config), "clearing")
    ) {
      return NextResponse.json({ error: "Media product slates are not enabled" }, { status: 409 });
    }
    const result = await db.collection<MediaProductProject>(MEDIA_PRODUCT_PROJECTS).updateOne(
      {
        _id: projectId,
        corporationId: corporation._id.toString(),
        activeDevelopmentCorporationId: corporation._id.toString(),
        stage: "development",
      },
      { $set: { stage: "retired" }, $unset: { activeDevelopmentCorporationId: "" } }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: "Active media product project not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { retired: true },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
