import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { clampWageLevel } from "@/lib/labour/laborCost";
import { isLabourWagesEnabled } from "@/lib/labour/featureFlag";
import type { CorporateSector } from "@/lib/db/types";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { setSectorWageLevelSchema } from "@/lib/api/schemas/corporations";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

/**
 * POST /api/corporations/[id]/sectors/[sectorId]/wage
 * Set the CEO-directed wage level for a sector (Labour system, Phase 2).
 * 1.0 is the profit-invariant baseline; lower cuts wages, higher pays up.
 * CEO only. Available only when labourSystemMode ≥ "wages".
 */
export async function setSectorWageLevel(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    // Gate: the wage lever only exists when the labour system is on.
    if (!(await isLabourWagesEnabled())) {
      return NextResponse.json({ error: "The labour system is not enabled." }, { status: 403 });
    }

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, sectorId } = await params;
    const parsed = await parseJsonBody(request, setSectorWageLevelSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { wageLevel } = parsed.data;
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

    const clamped = clampWageLevel(wageLevel);

    await db
      .collection<CorporateSector>("corporateSectors")
      .updateOne({ _id: sector._id }, { $set: { wageLevel: clamped, updatedAt: new Date() } });

    return NextResponse.json({ success: true, wageLevel: clamped });
  } catch (error) {
    return handleRouteError(error);
  }
}
