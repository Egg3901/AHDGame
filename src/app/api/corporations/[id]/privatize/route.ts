import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { requireCorporationActionsEnabled } from "@/lib/api/requireCorporationActions";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { openPrivatizationVote } from "@/lib/corporations/commands/privatization/openPrivatizationVote";
import {
  logWireEvent,
  wireHeadlineCorpPrivatized,
  wireHeadlineCorpPrivatizationVoteOpened,
} from "@/lib/wireEvent";
import type { Character } from "@/lib/db/types";
import { notifyVoteEventRaw } from "@/lib/corporations/votes/voteNotifications";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/corporations/[id]/privatize
 * Open a 24-turn privatization buyout vote. CEO only, requires >75% ownership,
 * reserves worst-case payout from CEO personal funds at vote-open time.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 5, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id } = await params;
    const db = await getDb();
    const corpGuard = await requireCorporationActionsEnabled(db);
    if (corpGuard) return corpGuard;

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: corporation.ceoId });
    if (!character) {
      return NextResponse.json({ error: "CEO character not found" }, { status: 404 });
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;
    const forexEnabled = await isForexEnabled();

    const result = await openPrivatizationVote({
      db,
      corporation,
      character,
      currentTurn,
      forexEnabled,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (result.immediate) {
      logWireEvent("corporation_privatized", wireHeadlineCorpPrivatized(corporation.name), {
        href: `/corporation/${corporation.sequentialId ?? corporation._id}`,
      });
      return NextResponse.json({ privatized: true, immediate: true });
    }

    logWireEvent(
      "corporation_privatization_vote_opened",
      wireHeadlineCorpPrivatizationVoteOpened(corporation.name, result.lockedBuyoutPrice),
      { href: `/corporation/${corporation.sequentialId ?? corporation._id}` }
    );
    void notifyVoteEventRaw({
      db,
      corporationId: corporation._id,
      voteId: result.voteId,
      corpName: corporation.name,
      summary: "take the corporation private (buyout)",
      notificationType: "corp_vote_opened",
    });

    return NextResponse.json({
      voteId: result.voteId.toString(),
      lockedBuyoutPrice: result.lockedBuyoutPrice,
      totalReservedCash: result.totalReservedCash,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
