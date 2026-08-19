// POST /api/admin/corporations/[id]/force-liquidate
// Admin: dissolve a corporation (same settlement as bond-default dissolve). Does not require CEO.
// Auth: requireAdmin
// Errors: 403, 400, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
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
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) });
    if (!corp) throw notFound("Corporation not found");

    if (corp.imfInstitution) {
      return NextResponse.json(
        { error: "Cannot force-liquidate the IMF institution" },
        { status: 400 }
      );
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
      return NextResponse.json(
        { error: "Bond settlement is already in progress for this corporation" },
        { status: 409 }
      );
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
