import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { isInNewCharacterCooldown } from "@/lib/auth/newCharacterCooldown";
import { getPartyTenure } from "@/lib/parties/leadershipTenure";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug } from "@/lib/db/caucusLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type {
  CaucusChairCandidate,
  CaucusChairElection,
  CaucusChairVote,
  CaucusMembership,
} from "@/lib/db/types";

const bodySchema = z
  .object({
    candidateId: z
      .string()
      .regex(/^[0-9a-fA-F]{24}$/, "Candidate id must be a valid ObjectId")
      .optional(),
    withdraw: z.boolean().optional(),
  })
  .refine((value) => value.withdraw === true || !!value.candidateId, {
    message: "Candidate id is required unless withdrawing your vote.",
    path: ["candidateId"],
  });

// POST /api/country/[code]/parties/[id]/caucuses/[slug]/election/vote — Cast or change a vote in the caucus chair election
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 403, 404
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; slug: string }> }
) {
  try {
    const { code, id, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, bodySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyId = String(party.sequentialId);
    const resolved = await findCaucusBySlug(db, countryId, partyId, slug);
    if (!resolved) {
      return NextResponse.json({ error: "Caucus not found" }, { status: 404 });
    }
    const { caucus } = resolved;

    const membership = await db.collection<CaucusMembership>("caucusMemberships").findOne({
      caucusId: caucus._id,
      memberType: "character",
      memberId: auth.user.character._id,
      status: "active",
    });
    if (!membership) {
      return NextResponse.json(
        { error: "Only active caucus members may vote in this election." },
        { status: 403 }
      );
    }

    const userDoc = await db
      .collection("users")
      .findOne({ _id: auth.user.character.userId }, { projection: { createdAt: 1 } });
    const cooldown = isInNewCharacterCooldown({
      userCreatedAt: userDoc?.createdAt ?? new Date(0),
      characterCreatedAt: auth.user.character.createdAt,
      partyJoinedAt: auth.user.character.partyJoinedAt,
      includePartyJoinedAt: false,
    });
    if (cooldown.blocked) {
      return NextResponse.json(
        {
          error:
            "New characters can't vote in caucus chair elections for 24 hours. Try again later.",
        },
        { status: 403 }
      );
    }

    const election = await db.collection<CaucusChairElection>("caucusChairElections").findOne({
      caucusId: caucus._id,
      status: "voting",
    });
    if (!election) {
      return NextResponse.json(
        { error: "No active caucus chair election found." },
        { status: 404 }
      );
    }

    // Minimum party tenure before voting in caucus chair elections (leadershipTenure.ts).
    const currentTurn = await getCurrentTurn(db);
    const tenure = getPartyTenure(auth.user.character.partyJoinedTurn, currentTurn);
    if (!tenure.eligible) {
      return NextResponse.json(
        {
          error: `You must be a member of this party for ${tenure.turnsRemaining} more turn${tenure.turnsRemaining === 1 ? "" : "s"} before you can vote in leadership elections.`,
          turnsRemaining: tenure.turnsRemaining,
        },
        { status: 403 }
      );
    }

    const now = new Date();
    if (parsed.data.withdraw) {
      await db.collection<CaucusChairVote>("caucusChairVotes").deleteOne({
        electionId: election._id,
        voterId: auth.user.character._id,
      });

      return NextResponse.json({
        success: true,
        message: "Your caucus chair vote has been withdrawn.",
      });
    }

    const candidateOid = new ObjectId(parsed.data.candidateId!);
    const candidate = await db.collection<CaucusChairCandidate>("caucusChairCandidates").findOne({
      electionId: election._id,
      characterId: candidateOid,
      status: "active",
    });
    if (!candidate) {
      return NextResponse.json(
        { error: "Candidate not found or no longer active." },
        { status: 404 }
      );
    }

    await db.collection<CaucusChairVote>("caucusChairVotes").updateOne(
      { electionId: election._id, voterId: auth.user.character._id },
      {
        $set: {
          caucusId: caucus._id,
          candidateId: candidate.characterId,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: new ObjectId(),
          electionId: election._id,
          voterId: auth.user.character._id,
          createdAt: now,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({
      success: true,
      message: `Voted for ${candidate.characterName} in the caucus chair election.`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
