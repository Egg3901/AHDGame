import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { getGameState } from "@/lib/gameState";
import { resolveCorporationVoteIfReady } from "@/lib/corporations/votes/voteService";
import { notifyVoteEvent } from "@/lib/corporations/votes/voteNotifications";
import { applyPassedVoteEffects } from "@/lib/corporations/votes/voteEffects";
import { totalVotingPower } from "@/lib/corporations/superShares";
import type { CorporationVote } from "@/lib/db/types/corporationVote";

interface RouteParams {
  params: Promise<{ id: string; voteId: string }>;
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id, voteId } = await params;
    if (!ObjectId.isValid(voteId)) {
      return NextResponse.json({ error: "Invalid vote ID" }, { status: 400 });
    }
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const vote = await db.collection<CorporationVote>("corporationVotes").findOne({
      _id: new ObjectId(voteId),
      corporationId: corporation._id,
    });
    if (!vote) return NextResponse.json({ error: "Vote not found" }, { status: 404 });

    if (vote.status === "open") {
      const gameState = await getGameState();
      const currentTurn = gameState?.currentTurn ?? 0;
      const { outcome, claimed } = await resolveCorporationVoteIfReady({
        db,
        vote,
        totalEligibleShares: totalVotingPower(corporation),
        currentTurn,
      });
      // Side effects only fire on the caller that won the atomic status flip,
      // never on losers of a parallel race. Otherwise notifications spam and
      // share_issuance / governance effects double-apply.
      if (claimed && outcome !== "open") {
        const notificationType =
          outcome === "passed" ? "corp_vote_passed" : ("corp_vote_failed" as const);
        if (outcome === "passed") {
          await applyPassedVoteEffects({ db, vote, corporation, currentTurn });
        }
        await notifyVoteEvent({ db, vote, corpName: corporation.name, notificationType });
      }
      if (outcome !== "open") {
        const updated = await db
          .collection<CorporationVote>("corporationVotes")
          .findOne({ _id: vote._id });
        return NextResponse.json(updated);
      }
    }

    return NextResponse.json(vote);
  } catch (e) {
    return handleRouteError(e);
  }
}
