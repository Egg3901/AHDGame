import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { clampProductionPolicy } from "@/lib/utils/productionPolicy";
import type { CorporateSector } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { setSectorPolicySchema as setPolicySchema } from "@/lib/api/schemas/corporations";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

/**
 * POST /api/corporations/[id]/sectors/[sectorId]/policy
 * Set the CEO-directed production policy target for a sector.
 * The active level trends toward this target at 1 point per turn.
 * CEO only. No cooldown.
 */
export async function setSectorPolicy(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const parsed = await parseJsonBody(request, setPolicySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { productionPolicy } = parsed.data;
    const db = await getDb();

    // Resolve corporation + CEO check
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    // Resolve sector
    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: new ObjectId(sectorId), corporationId: corporation._id });

    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    const clamped = clampProductionPolicy(productionPolicy);

    await db
      .collection<CorporateSector>("corporateSectors")
      .updateOne(
        { _id: sector._id },
        { $set: { productionPolicy: clamped, updatedAt: new Date() } }
      );

    return NextResponse.json({ success: true, productionPolicy: clamped });
  } catch (error) {
    return handleRouteError(error);
  }
}
