import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import {
  evaluateEscrowWithdrawal,
  ESCROW_WITHDRAW_COOLDOWN_TURNS,
} from "@/lib/corporations/escrowFunding";
import { buildEscrowWithdrawalTxEntry } from "@/lib/corporations/escrowTxLog";
import { emitTx } from "@/lib/financialTxLog/emit";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { Corporation } from "@/lib/db/types";

const schema = z.object({
  /** Amount in the corporation's local (liquidCurrencyCode) units. */
  amount: z.number().positive("Amount must be positive"),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/escrow-withdraw
 * CEO sweeps a positive share-buyback escrow balance back into liquidCapital.
 * Escrow and liquidCapital are both in the corp's local currency, so this is a
 * 1:1 internal move (no FX). Gated to once per ESCROW_WITHDRAW_COOLDOWN_TURNS
 * and capped at the positive balance (the withdrawal can't drive escrow negative).
 *
 * Body: { amount: number } — corp local currency
 * Auth: CEO only
 * Errors: 400, 401, 403, 404, 409
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const parsed = await parseJsonBody(request, schema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { amount } = parsed.data;

    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    const escrowBalance = corporation.shareEscrowBalance ?? 0;

    const verdict = evaluateEscrowWithdrawal({
      escrowBalance,
      amount,
      currentTurn,
      lastWithdrawalTurn: corporation.lastEscrowWithdrawalTurn,
    });
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.error }, { status: verdict.status });
    }

    // Atomic, race-safe move: the filter re-asserts the positive-balance and
    // cooldown invariants so two concurrent withdrawals can't both pass the
    // read-side check above and over-withdraw.
    const cooldownFloor = currentTurn - ESCROW_WITHDRAW_COOLDOWN_TURNS;
    const now = new Date();
    const result = await db.collection<Corporation>("corporations").updateOne(
      {
        _id: corporation._id,
        shareEscrowBalance: { $gte: amount },
        $or: [
          { lastEscrowWithdrawalTurn: { $exists: false } },
          { lastEscrowWithdrawalTurn: { $lte: cooldownFloor } },
        ],
      },
      {
        $inc: { shareEscrowBalance: -amount, liquidCapital: amount },
        $set: { lastEscrowWithdrawalTurn: currentTurn, updatedAt: now },
      }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json(
        { error: "Escrow changed before the withdrawal could be applied" },
        { status: 409 }
      );
    }

    const withdrawalEntry = buildEscrowWithdrawalTxEntry({
      corpId: corporation._id,
      corpName: corporation.name,
      currencyCode: (corporation.liquidCurrencyCode ?? "USD") as CurrencyCode,
      turn: currentTurn,
      createdAt: now,
      amount,
      escrowBalanceAfter: escrowBalance - amount,
    });
    if (withdrawalEntry) {
      // Fire-and-forget — a dropped audit write must not fail the withdrawal.
      void emitTx(db, withdrawalEntry);
    }

    return NextResponse.json({
      success: true,
      withdrawn: amount,
      escrowRemaining: escrowBalance - amount,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
