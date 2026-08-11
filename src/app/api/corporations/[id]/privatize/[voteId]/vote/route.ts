import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { privatizationVoteSchema } from "@/lib/api/schemas/corporations";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { castPrivatizationVote } from "@/lib/corporations/commands/privatization/castPrivatizationVote";
import { resolvePrivatizationVote } from "@/lib/corporations/commands/privatization/resolvePrivatizationVote";
import { handleRouteError } from "@/lib/api/errors";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getGameState } from "@/lib/gameState";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type { Character, CorporationPrivatizationVote } from "@/lib/db/types";

interface RouteParams {
  params: Promise<{ id: string; voteId: string }>;
}

/**
 * POST /api/corporations/[id]/privatize/[voteId]/vote
 * Cast a yes/no vote on an open privatization buyout vote. Auth: any non-CEO
 * character holding shares in this corp at the moment of casting. Re-casting
 * overwrites the previous vote.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const rateLimit = checkRateLimit(auth.user.userId, 30, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const { id, voteId } = await params;
    const parsed = await parseJsonBody(request, privatizationVoteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    if (!ObjectId.isValid(voteId)) {
      return NextResponse.json({ error: "Invalid vote id" }, { status: 400 });
    }

    const db = await getDb();
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const vote = await db
      .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
      .findOne({ _id: new ObjectId(voteId), corporationId: corporation._id });
    if (!vote) {
      return NextResponse.json({ error: "Vote not found" }, { status: 404 });
    }

    const voterCharacter = await db
      .collection<Character>("characters")
      .findOne({ userId: new ObjectId(auth.user.userId) });
    if (!voterCharacter) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 0;

    const result = await castPrivatizationVote({
      db,
      corporation,
      vote,
      voterCharacterId: voterCharacter._id,
      voteValue: parsed.data.vote,
      currentTurn,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (result.autoResolve) {
      const forexEnabled = await isForexEnabled();
      const freshVote = await db
        .collection<CorporationPrivatizationVote>("corporationPrivatizationVotes")
        .findOne({ _id: vote._id, status: "open" });
      if (freshVote) {
        await resolvePrivatizationVote({
          db,
          vote: freshVote,
          currentTurn,
          forexEnabled,
          force: true,
        });
      }
    }

    return NextResponse.json({
      voteShares: result.voteShares,
      tally: result.tally,
      autoResolved: result.autoResolve,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
