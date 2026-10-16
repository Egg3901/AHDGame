import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { isMarketSystemMode, marketAtLeast, getMarketSystemMode } from "@/lib/market/featureFlag";
import type { CorporateSector } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { setSectorPricingSchema } from "@/lib/api/schemas/corporations";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

/** Save the owner's next-turn per-product quote policies. */
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

    const { quotes } = parsed.data;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    if (!ObjectId.isValid(sectorId)) {
      return errorResponse(400, "Invalid sector ID");
    }

    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne(
        { _id: new ObjectId(sectorId), corporationId: corporation._id },
        { projection: { _id: 1 } }
      );

    if (!sector) {
      return errorResponse(404, "Sector not found");
    }

    const written = await db
      .collection<CorporateSector>("corporateSectors")
      .updateOne(
        { _id: sector._id, corporationId: corporation._id },
        { $set: { producerQuotes: quotes, updatedAt: new Date() } }
      );
    if (written.matchedCount !== 1) {
      return errorResponse(409, "Sector ownership changed. Refresh before changing prices.");
    }

    return NextResponse.json({ success: true, quotes });
  } catch (error) {
    return handleRouteError(error);
  }
}
