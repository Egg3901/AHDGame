/**
 * POST /api/whitehouse/cabinet/nominations/[id]/vote — Senator votes on nomination
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
import type { CabinetNomination, ElectedOfficial, Character } from "@/lib/db/types";

const voteSchema = z.object({
  vote: z.enum(["for", "against", "abstain"]),
});

// POST /api/whitehouse/cabinet/nominations/[id]/vote — Senator votes for, against, or abstains on a cabinet nomination.
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
      `cabinet:${authUser.userId}`,
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
    // Deadline check uses the game clock (turn-number preferred, date fallback)
    // so a stalled or drifted real clock can't open/close the window early.
    const gameTime = await getGameTime();

    const nomination = await db.collection<CabinetNomination>("cabinetNominations").findOne({
      _id: nominationOid,
      status: "active",
    });
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

    const legislatorOfficial = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: myCharacter._id,
      officeType: { $in: ["senate", "house"] },
    });
    if (!legislatorOfficial) {
      return NextResponse.json(
        { error: "Only members of Congress can vote on nominations" },
        { status: 403 }
      );
    }

    const isVpNomination = nomination.positionId === "vicePresident";
    const isHouse = legislatorOfficial.officeType === "house";

    // Cabinet nominations: Senate only. VP nominations: both chambers.
    if (!isVpNomination && isHouse) {
      return NextResponse.json(
        { error: "Only Senators can vote on cabinet nominations" },
        { status: 403 }
      );
    }

    const voteKey = myCharacter._id.toString();
    const voteField = isVpNomination && isHouse ? "houseVotes" : "votes";
    const tallyFieldByVote =
      isVpNomination && isHouse
        ? { for: "houseVotesFor", against: "houseVotesAgainst", abstain: "houseVotesAbstain" }
        : { for: "votesFor", against: "votesAgainst", abstain: "votesAbstain" };

    const updateResult = await db.collection<CabinetNomination>("cabinetNominations").updateOne(
      { _id: nominationOid, status: "active" },
      buildEmbeddedVoteTallyUpdate({
        voteField,
        voteKey,
        vote,
        tallyFieldByVote,
        updatedAt: now,
      })
    );
    if (updateResult.matchedCount === 0) {
      return NextResponse.json({ error: "Nomination not found or voting closed" }, { status: 404 });
    }

    await clearWhippedFromVote(db, "cabinetNominations", nominationOid, myCharacter._id);

    return NextResponse.json({
      success: true,
      message: `Vote recorded: ${vote}`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
