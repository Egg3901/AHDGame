import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { bondDefaultDissolveSchema } from "@/lib/api/schemas/bondDefault";
import { handleRouteError, internalError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import {
  executeCorporationBondDefaultDissolution,
  getDissolutionCompletedResult,
} from "@/lib/bonds/executeCorporationBondDefaultDissolution";
import {
  BOND_DISSOLUTION_HOLDER,
  BOND_DISSOLUTION_POOL,
} from "@/lib/bonds/bondDissolutionSpend";
import { MoneyFlowKeyConflictError, MoneyFlowTerminalError } from "@/lib/db/nonAtomicMoneyFlow";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { withCorporationSettlementLock } from "@/lib/corporations/settlementLock";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import {
  corporationDissolutionAgeBlock,
  dissolutionAgeBlockedMessage,
} from "@/lib/corporations/dissolutionAgeGuard";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/bond-default/dissolve
 * CEO-only. Dissolve the corporation: pay bondholders pro-rata from assets (LC + sector NPV),
 * then distribute remaining assets to shareholders pro-rata by shares.
 * Body: { "confirm": true }
 *
 * Crash-safe settlement (issue #1672): the payout waterfall runs as
 * exactly-once money flow under the client's `Idempotency-Key` (minted when
 * absent). A retry with the same key replays the stored outcome instead of
 * paying again — including after the corporation is already gone, when the
 * route answers from the completed receipt instead of 404ing.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const headerKey = request.headers.get("Idempotency-Key");
    if (headerKey !== null && (headerKey.length === 0 || headerKey.length > 128)) {
      return NextResponse.json({ error: "Invalid Idempotency-Key header" }, { status: 400 });
    }

    const { id } = await params;
    const parsed = await parseJsonBody(request, bondDefaultDissolveSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    // Dissolving the corporation to resolve a bond default is a corporation
    // action: blocked while an admin has paused corporation actions.
    const pausedGuard = await requireCorporationActionsEnabled(db);
    if (pausedGuard) return pausedGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) {
      // Corp-gone replay (issue #1672): a client retry after the terminal
      // cleanup deleted the corporation would 404 here and strand the
      // completed receipt. With a key, answer from the stored outcome. A key
      // mismatch falls through to the historical 404: with no corp doc left
      // a hex mismatch is indistinguishable from a retry on a different URL
      // form (sequential vs ObjectId), so only a settled-terminal receipt
      // stays loud.
      if (headerKey !== null) {
        try {
          const replayed = await getDissolutionCompletedResult(db, headerKey, id);
          if (replayed) {
            return NextResponse.json({
              success: true,
              ...replayed,
              message: `Corporation has been dissolved. Bondholders and shareholders were paid from liquid capital and sector NPV (see response for breakdown).`,
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
      return resolved.response;
    }
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const currentTurn = await getCurrentTurn(db);
    const ageBlock = corporationDissolutionAgeBlock(corporation.foundedAtTurn, currentTurn);
    if (ageBlock.blocked) {
      return NextResponse.json(
        { error: dissolutionAgeBlockedMessage(ageBlock.turnsRemaining) },
        { status: 400 }
      );
    }

    const now = new Date();
    // Map a keyed-settlement failure back onto the historical surface: a
    // vanished holder or pool row is the 500 inconsistent error, a settled or
    // foreign key the 409. The primitive already compensated any applied
    // prefix.
    let result: Awaited<ReturnType<typeof executeCorporationBondDefaultDissolution>> | null;
    try {
      result = await withCorporationSettlementLock(
        db,
        corporation._id,
        "bondSettlementInProgressAt",
        now,
        async () =>
          executeCorporationBondDefaultDissolution(db, corporation, {
            requireDefaultedBonds: true,
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
      corporateShareholderPayouts: result.corporateShareholderPayouts,
      publicFloatPayout: result.publicFloatPayout,
      totalPayoutToPeople: result.totalPayoutToPeople,
      message: `${corporation.name} has been dissolved. Bondholders and shareholders were paid from liquid capital and sector NPV (see response for breakdown).`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
