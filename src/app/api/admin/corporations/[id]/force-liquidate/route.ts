// POST /api/admin/corporations/[id]/force-liquidate
// Admin: dissolve a corporation (same settlement as bond-default dissolve). Does not require CEO.
// Auth: requireAdmin
// Errors: 403, 400, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, internalError, notFound } from "@/lib/api/errors";
import type { Corporation } from "@/lib/db/types";
import { z } from "zod";
import {
  executeCorporationBondDefaultDissolution,
  getDissolutionCompletedResult,
} from "@/lib/bonds/executeCorporationBondDefaultDissolution";
import {
  BOND_DISSOLUTION_HOLDER,
  BOND_DISSOLUTION_POOL,
} from "@/lib/bonds/bondDissolutionSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
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

    // Crash-safe settlement (issue #1672): same Idempotency-Key contract as
    // the CEO dissolve route; a retry with the same key replays instead of
    // paying again.
    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const db = await getDb();
    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) });
    if (!corp) {
      // Corp-gone replay (issue #1672): answer a keyed retry from the
      // completed receipt instead of 404ing. A key mismatch falls through
      // to the historical 404 (see the CEO dissolve route); only a
      // settled-terminal receipt stays loud.
      if (headerKey !== null) {
        try {
          const replayed = await getDissolutionCompletedResult(db, headerKey, id);
          if (replayed) {
            return NextResponse.json({
              success: true,
              ...replayed,
              message: `Corporation has been liquidated by admin.`,
            });
          }
        } catch (err) {
          if (err instanceof MoneyFlowTerminalError) {
            return NextResponse.json(
              { error: "Dissolution already settled; start a new attempt with a new key." },
              { status: 409 }
            );
          }
          if (!(err instanceof MoneyFlowKeyConflictError)) throw err;
        }
      }
      throw notFound("Corporation not found");
    }

    if (corp.imfInstitution) {
      return NextResponse.json(
        { error: "Cannot force-liquidate the IMF institution" },
        { status: 400 }
      );
    }

    let result: Awaited<ReturnType<typeof executeCorporationBondDefaultDissolution>> | null;
    try {
      result = await withCorporationSettlementLock(
        db,
        corp._id,
        "bondSettlementInProgressAt",
        new Date(),
        async () =>
          executeCorporationBondDefaultDissolution(db, corp, {
            requireDefaultedBonds: false,
            ...(headerKey !== null ? { idempotencyKey: headerKey } : {}),
          })
      );
    } catch (err) {
      if (err instanceof MoneyFlowTerminalError) {
        return NextResponse.json(
          { error: "Dissolution already settled; start a new attempt with a new key." },
          { status: 409 }
        );
      }
      if (err instanceof MoneyFlowKeyConflictError) {
        return NextResponse.json(
          { error: "Idempotency key was reused for a different dissolution." },
          { status: 409 }
        );
      }
      const message = err instanceof Error ? err.message : "";
      if (
        message.startsWith(BOND_DISSOLUTION_HOLDER) ||
        message.startsWith(BOND_DISSOLUTION_POOL)
      ) {
        throw internalError("Bond holder data is inconsistent; contact an admin.");
      }
      throw err;
    }

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
