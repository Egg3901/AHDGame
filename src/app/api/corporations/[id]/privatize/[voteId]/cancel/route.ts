import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { cancelPrivatizationVote } from "@/lib/corporations/commands/privatization/cancelPrivatizationVote";
import { handleRouteError } from "@/lib/api/errors";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { logWireEvent, wireHeadlineCorpPrivatizationVoteCancelled } from "@/lib/wireEvent";
import { notifyVoteEventRaw } from "@/lib/corporations/votes/voteNotifications";
import type { CorporationPrivatizationVote } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string; voteId: string }>;
}

/**
 * POST /api/corporations/[id]/privatize/[voteId]/cancel
 * CEO cancels their own open privatization vote. Refunds reserved cash.
 * Does NOT apply the failed-vote cooldown.
 */
export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id, voteId } = await params;
    if (!ObjectId.isValid(voteId)) {
      return NextResponse.json({ error: "Invalid vote id" }, { status: 400 });
    }
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;
    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;
    const vote = await db
      .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
      .findOne({ _id: new ObjectId(voteId), corporationId: corporation._id });
    if (!vote) return NextResponse.json({ error: "Vote not found" }, { status: 404 });
    const forex = await isForexEnabled();
    const result = await cancelPrivatizationVote({ db, vote, forexEnabled: forex });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    logWireEvent(
      "corporation_privatization_vote_cancelled",
      wireHeadlineCorpPrivatizationVoteCancelled(corporation.name),
      { href: `/corporation/${corporation.sequentialId ?? corporation._id}` }
    );
    void notifyVoteEventRaw({
      db,
      corporationId: corporation._id,
      voteId: vote._id,
      corpName: corporation.name,
      summary: "take the corporation private (buyout)",
      notificationType: "corp_vote_cancelled",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
