// POST /api/admin/corporations/[id]/force-liquidate
// Admin: dissolve a corporation (same settlement as bond-default dissolve). Does not require CEO.
// Auth: requireAdmin
// Errors: 403, 400, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound, errorResponse } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";
import { z } from "zod";
import { executeCorporationBondDefaultDissolution } from "@/lib/bonds/executeCorporationBondDefaultDissolution";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";

const schema = z.object({ confirm: z.literal(true) });

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/corporations/[id]/force-liquidate
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const db = await getDb();
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) });
    if (!corp) throw notFound("Corporation not found");

    if (corp.imfInstitution) {
      return errorResponse(400, "Cannot force-liquidate the IMF institution");
    }

    const result = await withCorporationSettlementLock(
      db,
      corp._id,
      "bondSettlementInProgressAt",
      new Date(),
      async () =>
        executeCorporationBondDefaultDissolution(db, corp, {
          requireDefaultedBonds: false,
        })
    );

    if (!result) {
      return errorResponse(409, "Bond settlement is already in progress for this corporation");
    }

    return NextResponse.json({
      success: true,
      bondRecoveryPool: result.bondRecoveryPool,
      shareholderPool: result.shareholderPool,
      shareholderPayouts: result.shareholderPayouts,
      message: `${corp.name} has been liquidated by admin.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
