/**
 * POST /api/whitehouse/scotus/nominations/[id]/vote — Senator votes on a SCOTUS nomination
 *
 * Mirrors /api/whitehouse/cabinet/nominations/[id]/vote exactly (Senate-only
 * branch) — reuses the same embedded-vote-tally + whip-clear helpers.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseObjectId } from "@/lib/utils/objectId";
import { clearWhippedFromVote } from "@/lib/congress/clearWhippedVote";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { z } from "zod";
import { CONGRESS_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { buildEmbeddedVoteTallyUpdate } from "@/lib/votes/embeddedVoteTally";
import { getGameTime } from "@/lib/time/gameTime";
import { isVotingDeadlinePassed } from "@/lib/legislature/billVotingWindow";
import type { ElectedOfficial, Character } from "@/lib/db/types";
import type { ScotusNomination } from "@/lib/db/types/scotus";

const voteSchema = z.object({
  vote: z.enum(["for", "against", "abstain"]),
});

// POST /api/whitehouse/scotus/nominations/[id]/vote — Senator votes for, against, or abstains on a SCOTUS nomination.
// Auth: requireBasicAuth
// Errors: 400, 401, 403, 404, 409, 429
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const nominationOid = parseObjectId(id);
    if (!nominationOid) {
      return NextResponse.json({ error: "Invalid nomination ID" }, { status: 400 });
    }

    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const limit = checkRateLimit(
      `scotus:${authUser.userId}`,
      CONGRESS_LIMITS.maxRequests,
      CONGRESS_LIMITS.windowMs
    );
    if (!limit.ok) return rateLimitResponse(limit.retryAfter);

    const parsed = await parseJsonBody(request, voteSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    const { vote } = parsed.data;

    const db = await getDb();
    const now = new Date();
    const gameTime = await getGameTime();

    const nomination = await db
      .collection<ScotusNomination>("scotusNominations")
      .findOne({ _id: nominationOid, status: "active" });
    if (!nomination) {
      return NextResponse.json({ error: "Nomination not found or voting closed" }, { status: 404 });
    }
    if (
      isVotingDeadlinePassed(
        nomination.votingEndsAt,
        gameTime.effectiveNow,
        nomination.votingEndsOnTurn,
        gameTime.currentTurn
      )
    ) {
      return NextResponse.json({ error: "Voting has ended" }, { status: 409 });
    }

    const myCharacter = await db.collection<Character>("characters").findOne({
      userId: new ObjectId(authUser.userId),
    });
    if (!myCharacter) {
      return NextResponse.json({ error: "No character" }, { status: 400 });
    }

    const senatorOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: myCharacter._id,
      officeType: "senate",
    });
    if (!senatorOfficial) {
      return NextResponse.json(
        { error: "Only Senators can vote on Justice nominations" },
        { status: 403 }
      );
    }

    const voteKey = myCharacter._id.toString();
    const updateResult = await db.collection<ScotusNomination>("scotusNominations").updateOne(
      { _id: nominationOid, status: "active" },
      buildEmbeddedVoteTallyUpdate({
        voteField: "votes",
        voteKey,
        vote,
        tallyFieldByVote: { for: "votesFor", against: "votesAgainst", abstain: "votesAbstain" },
        updatedAt: now,
      })
    );
    if (updateResult.matchedCount === 0) {
      return NextResponse.json({ error: "Nomination not found or voting closed" }, { status: 404 });
    }

    await clearWhippedFromVote(db, "scotusNominations", nominationOid, myCharacter._id);

    return NextResponse.json({ success: true, message: `Vote recorded: ${vote}` });
  } catch (error) {
    return handleRouteError(error);
  }
}
