import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getGameTime } from "@/lib/time/gameTime";
import { canActAsChair } from "@/lib/parties/actingChair";

const voteSchema = z.object({
  vote: z.enum(["yes", "no"]),
});

// POST /api/coalitions/[id]/disband/vote — Cast or change a disband vote
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

    const authResult = await requireAuthWithCharacter();
    if (!authResult.ok) return authResult.response;

    const rateLimit = checkRateLimit(authResult.user.userId, 20, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
    const { character } = authResult.user;

    const parsed = await parseJsonBody(request, voteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const sequentialId = parseInt(id, 10);
    if (isNaN(sequentialId)) {
      throw badRequest("Coalition ID must be a number.");
    }

    const db = await getDb();
    const gameTime = await getGameTime();

    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId, countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Verify a disband vote is active. Turn-first (matches the resolver, which
    // auto-resolves on `expiresOnTurn`) with a wall-clock fallback for legacy
    // in-flight votes.
    const now = new Date(gameTime.effectiveNow);
    const disbandVoteActive =
      !!coalition.disbandVote &&
      (typeof coalition.disbandVote.expiresOnTurn === "number"
        ? coalition.disbandVote.expiresOnTurn > gameTime.currentTurn
        : coalition.disbandVote.expiresAt > now);
    if (!disbandVoteActive) {
      throw badRequest("There is no active disband vote for this coalition.");
    }

    // Find the user's party and verify they are the national chair
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ chairId: character._id, countryId });
    if (!party) {
      throw forbidden("You must be a national party chair to vote on a disband.");
    }

    if (!canActAsChair(party, character._id)) {
      throw forbidden(
        "You must be the national chair of your party (or acting vice-chair) to vote."
      );
    }

    // Verify the party is a member of the coalition
    const isMember = coalition.members.some((m) => String(m.partyId) === String(party._id));
    if (!isMember) {
      throw forbidden("Your party is not a member of this coalition.");
    }

    // Remove any existing vote for this party, then add the new vote.
    // Use a pipeline update so the filter + append is atomic.
    const newVote = {
      partyId: party._id,
      characterId: character._id,
      vote: (parsed.data as { vote: "yes" | "no" }).vote,
      votedAt: now,
    };

    await db.collection("coalitions").updateOne({ _id: coalition._id }, [
      {
        $set: {
          "disbandVote.votes": {
            $concatArrays: [
              {
                $filter: {
                  input: "$disbandVote.votes",
                  as: "v",
                  cond: { $ne: ["$$v.partyId", party._id] },
                },
              },
              [newVote],
            ],
          },
          updatedAt: now,
        },
      },
    ]);

    return NextResponse.json({ success: true, message: `Vote recorded: ${newVote.vote}` });
  } catch (error) {
    return handleRouteError(error);
  }
}
