import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import { cancelCorporationVote } from "@/lib/corporations/votes/voteService";
import { notifyVoteEvent } from "@/lib/corporations/votes/voteNotifications";
import type { CorporationVote } from "@/lib/db/types/corporationVote";

interface RouteParams {
  params: Promise<{ id: string; voteId: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id, voteId } = await params;
    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const vote = await db.collection<CorporationVote>("corporationVotes").findOne({
      _id: new ObjectId(voteId),
      corporationId: corporation._id,
    });
    if (!vote) return NextResponse.json({ error: "Vote not found" }, { status: 404 });
    if (vote.status !== "open")
      return NextResponse.json({ error: "Vote is not open" }, { status: 409 });

    await cancelCorporationVote({ db, vote });
    await notifyVoteEvent({
      db,
      vote,
      corpName: corporation.name,
      notificationType: "corp_vote_cancelled",
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleRouteError(e);
  }
}
