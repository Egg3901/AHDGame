/**
 * POST /api/corporations/[id]/sectors/[sectorId]/unlist
 * Remove an active for-sale listing on a sector. CEO only.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import type { CorporateSector } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

export async function unlistSectorForSale(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
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
      .findOne({ _id: new ObjectId(sectorId), corporationId: corporation._id });

    if (!sector) {
      return errorResponse(404, "Sector not found");
    }

    if (!sector.forSale) {
      return errorResponse(400, "Sector is not currently listed for sale");
    }

    const unlisted = await db.collection<CorporateSector>("corporateSectors").updateOne(
      {
        _id: sector._id,
        corporationId: corporation._id,
        constructionPropertyTransition: { $exists: false },
        "constructionFinancing.foreclosure": { $exists: false },
      },
      {
        $unset: { forSale: "" },
        $set: { updatedAt: new Date() },
      }
    );
    if (unlisted.matchedCount === 0)
      return errorResponse(409, "The listing belongs to a secured recovery or owner transition.");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
