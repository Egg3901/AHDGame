/**
 * POST /api/country/[code]/fomc/nominations/[id]/vote — Senator votes on an FOMC nomination
 *
 * The Senate confirmation that actually works: real player senators cast
 * for/against/abstain on a pending Fed chair / governor nomination, written into
 * the same `votes` map + tally fields the nomination lifecycle re-tallies at
 * resolution (`computeCabinetNominationTally` reads `nom.votes`). Mirrors the
 * cabinet nomination vote route. Senate only — the FOMC has no dual-chamber path.
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
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { FomcNomination } from "@/lib/db/types/centralBank";
import type { ElectedOfficial, Character } from "@/lib/db/types";

const voteSchema = z.object({
  vote: z.enum(["for", "against", "abstain"]),
});

// POST /api/country/[code]/fomc/nominations/[id]/vote — Senator votes for/against/abstain.
// Auth: requireBasicAuth. Errors: 400, 401, 403, 404, 409, 429
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }
    const nominationOid = parseObjectId(id);
    if (!nominationOid) {
      return NextResponse.json({ error: "Invalid nomination ID" }, { status: 400 });
    }

    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const limit = checkRateLimit(
      `fomc:${authUser.userId}`,
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
    // Game-clock deadline so a drifted real clock can't open/close early.
    const gameTime = await getGameTime();

    const nomination = await db.collection<FomcNomination>("fomcNominations").findOne({
      _id: nominationOid,
      countryId,
      status: "active",
    });
    if (!nomination) {
      return NextResponse.json({ error: "Nomination not found or voting closed" }, { status: 404 });
    }
    if (
      isVotingDeadlinePassed(
        undefined,
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

    // Senate only. The senator must sit in the nomination's own country — a
    // foreign legislator cannot confirm another nation's central bank.
    const senator = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      characterId: myCharacter._id,
      officeType: "senate",
      countryId,
    });
    if (!senator) {
      return NextResponse.json(
        { error: "Only Senators of this country can vote on Fed nominations" },
        { status: 403 }
      );
    }

    const updateResult = await db.collection<FomcNomination>("fomcNominations").updateOne(
      { _id: nominationOid, status: "active" },
      buildEmbeddedVoteTallyUpdate({
        voteField: "votes",
        voteKey: myCharacter._id.toString(),
        vote,
        tallyFieldByVote: {
          for: "votesFor",
          against: "votesAgainst",
          abstain: "votesAbstain",
        },
        updatedAt: now,
      })
    );
    if (updateResult.matchedCount === 0) {
      return NextResponse.json({ error: "Nomination not found or voting closed" }, { status: 404 });
    }

    await clearWhippedFromVote(db, "fomcNominations", nominationOid, myCharacter._id);

    return NextResponse.json({ success: true, message: `Vote recorded: ${vote}` });
  } catch (error) {
    return handleRouteError(error);
  }
}
