import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { resolvePrivatizationVote } from "@/lib/corporations/commands/privatization/resolvePrivatizationVote";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type { CorporationPrivatizationVote } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string; voteId: string }>;
}

/**
 * GET /api/corporations/[id]/privatize/[voteId]
 * Returns the current state of a privatization vote. Triggers lazy resolution
 * if the vote is past its deadline (matches the dissolutionInProgressAt /
 * bondSettlementInProgressAt pattern).
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id, voteId } = await params;
    if (!ObjectId.isValid(voteId)) {
      return NextResponse.json({ error: "Invalid vote id" }, { status: 400 });
    }
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    let vote = await db
      .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
      .findOne({ _id: new ObjectId(voteId), corporationId: corporation._id });
    if (!vote) return NextResponse.json({ error: "Vote not found" }, { status: 404 });

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    if (vote.status === "open" && currentTurn > vote.deadlineAtTurn) {
      const forex = await isForexEnabled();
      await resolvePrivatizationVote({ db, vote, currentTurn, forexEnabled: forex });
      vote = await db
        .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
        .findOne({ _id: vote._id });
      if (!vote) return NextResponse.json({ error: "Vote not found" }, { status: 404 });
    }

    const tally = (vote.votes ?? []).reduce(
      (acc, v) => {
        if (v.vote === "yes") acc.yes += v.voteShares;
        else acc.no += v.voteShares;
        return acc;
      },
      { yes: 0, no: 0 }
    );

    return NextResponse.json({
      vote: {
        _id: vote._id.toString(),
        status: vote.status,
        openedAtTurn: vote.openedAtTurn,
        deadlineAtTurn: vote.deadlineAtTurn,
        lockedBuyoutPrice: vote.lockedBuyoutPrice,
        lockedBuyoutCurrency: vote.lockedBuyoutCurrency,
        totalReservedCash: vote.totalReservedCash,
        votes: vote.votes.map((v) => ({
          characterId: v.characterId?.toString(),
          corporationId: v.corporationId?.toString(),
          voteShares: v.voteShares,
          vote: v.vote,
          castAt: v.castAt,
        })),
        tally,
        resolvedAt: vote.resolvedAt,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
