// POST /api/country/[code]/international-organizations/proposals/[proposalId]/vote
// Foreign minister of `code` votes on a pending membership proposal.
// Auth: requireAuthWithCharacter + requireForeignMinister (acting country must be a current member).
import { ObjectId } from "mongodb";
import { z } from "zod";
import { NextResponse } from "next/server";
import { clientIpFromRequest } from "@/lib/utils/network";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { requireForeignMinister } from "@/lib/api/requireForeignMinister";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { voteMembershipProposal } from "@/lib/internationalOrganizations/commands/voteMembershipProposal";

const voteSchema = z.object({
  vote: z.enum(["yes", "no", "abstain"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; proposalId: string }> }
) {
  try {
    const { code, proposalId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(badRequest("Invalid country code").toJson(), { status: 400 });
    }
    if (!ObjectId.isValid(proposalId)) {
      return NextResponse.json(badRequest("Invalid proposal id").toJson(), { status: 400 });
    }

    const body = await parseJsonBody(request, voteSchema);
    if (!body.success) {
      return NextResponse.json(badRequest(body.error).toJson(), { status: body.status });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const ip = clientIpFromRequest(request);
    const rateLimit = checkRateLimit(`org-vote:${ip}`, 30, 60_000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const db = await getDb();
    const foreignMinister = await requireForeignMinister(
      countryId,
      auth.user.character._id,
      auth.user.character.name,
      db
    );
    if (!foreignMinister.ok) return foreignMinister.response;

    const result = await voteMembershipProposal({
      db,
      countryId,
      proposalId,
      actor: {
        characterId: foreignMinister.auth.characterId,
        characterName: foreignMinister.auth.characterName,
      },
      vote: body.data.vote,
    });
    if (!result.ok) {
      const status = result.status === 404 ? 404 : 400;
      return NextResponse.json(badRequest(result.error).toJson(), { status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
