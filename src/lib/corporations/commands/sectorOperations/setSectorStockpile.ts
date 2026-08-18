import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import type { CorporateSector } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { setSectorStockpileSchema } from "@/lib/api/schemas/corporations";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

/**
 * POST /api/corporations/[id]/sectors/[sectorId]/stockpile
 * Toggle the sector between sell-all (default) and build-inventory: with the
 * toggle on, the unsold remainder of storable outputs accrues as sector
 * inventory instead of evaporating (design-realization-legs §6). Turning it
 * off stops accrual; an existing pile keeps spoiling, carrying cost, and
 * selling down. CEO only. No cooldown.
 */
export async function setSectorStockpile(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const parsed = await parseJsonBody(request, setSectorStockpileSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { stockpileUnsold } = parsed.data;
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

    await db
      .collection<CorporateSector>("corporateSectors")
      .updateOne({ _id: sector._id }, { $set: { stockpileUnsold, updatedAt: new Date() } });

    return NextResponse.json({ success: true, stockpileUnsold });
  } catch (error) {
    return handleRouteError(error);
  }
}
