// POST /api/country/[code]/international-organizations/leadership-elections/[electionId]/vote
// Foreign minister of `code` votes on a pending leadership (Secretary-General) election.
// All current members of the host org may vote.
import { ObjectId } from "mongodb";
import { z } from "zod";
import { NextResponse } from "next/server";
import { clientIpFromRequest } from "@/lib/utils/network";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requireForeignMinister } from "@/lib/api/requireForeignMinister";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getOrganizationLeadershipElectionsCollection } from "@/lib/db/collections";
import { isVotingMember } from "@/lib/internationalOrganizations/orgMembership";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { upsertPendingOrganizationVote } from "@/lib/internationalOrganizations/voteWrite";

const voteSchema = z.object({
  vote: z.enum(["yes", "no", "abstain"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; electionId: string }> }
) {
  try {
    const { code, electionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(badRequest("Invalid country code").toJson(), { status: 400 });
    }
    if (!ObjectId.isValid(electionId)) {
      return NextResponse.json(badRequest("Invalid election id").toJson(), { status: 400 });
    }

    const body = await parseJsonBody(request, voteSchema);
    if (!body.success) {
      return NextResponse.json(badRequest(body.error).toJson(), { status: body.status });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const ip = clientIpFromRequest(request);
    const rl = checkRateLimit(`org-sg-vote:${ip}`, 30, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const db = await getDb();
    const fm = await requireForeignMinister(
      countryId,
      auth.user.character._id,
      auth.user.character.name,
      db
    );
    if (!fm.ok) return fm.response;

    const col = await getOrganizationLeadershipElectionsCollection(db);
    const election = await col.findOne({ _id: new ObjectId(electionId) });
    if (!election) {
      return NextResponse.json(notFound("Election not found").toJson(), { status: 404 });
    }
    if (election.status !== "pending") {
      return NextResponse.json(badRequest("Voting is closed.").toJson(), { status: 400 });
    }
    if (!(await isVotingMember(db, election.organizationId, countryId))) {
      return NextResponse.json(
        badRequest(`${countryId} has no vote in ${election.organizationId}.`).toJson(),
        { status: 400 }
      );
    }

    const currentTurn = await getCurrentTurn(db);
    const newVote = {
      countryId,
      characterId: fm.auth.characterId,
      characterName: fm.auth.characterName,
      vote: body.data.vote as "yes" | "no" | "abstain",
      castAt: new Date(),
      castOnTurn: currentTurn,
    };
    const updateResult = await upsertPendingOrganizationVote(col, election._id, newVote);
    if (updateResult.matchedCount === 0) {
      return NextResponse.json(badRequest("Voting is closed.").toJson(), { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
