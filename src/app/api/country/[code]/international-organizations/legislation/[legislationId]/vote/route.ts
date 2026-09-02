// POST /api/country/[code]/international-organizations/legislation/[legislationId]/vote
// Foreign minister of `code` votes on a pending org-level legislation item.
// A free-trade agreement is decided only by the countries named as parties to
// it; every other resolution type is decided by the host org's voting roll.
// Either way the voter must still hold a vote in the org, because that is the
// roll the resolver tallies.
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
import { getOrganizationLegislationCollection } from "@/lib/db/collections";
import { isVotingMember } from "@/lib/internationalOrganizations/orgMembership";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { upsertPendingOrganizationVote } from "@/lib/internationalOrganizations/voteWrite";

const voteSchema = z.object({
  vote: z.enum(["yes", "no", "abstain"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; legislationId: string }> }
) {
  try {
    const { code, legislationId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json(badRequest("Invalid country code").toJson(), { status: 400 });
    }
    if (!ObjectId.isValid(legislationId)) {
      return NextResponse.json(badRequest("Invalid legislation id").toJson(), { status: 400 });
    }

    const body = await parseJsonBody(request, voteSchema);
    if (!body.success) {
      return NextResponse.json(badRequest(body.error).toJson(), { status: body.status });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const ip = clientIpFromRequest(request);
    const rl = checkRateLimit(`org-leg-vote:${ip}`, 30, 60_000);
    if (!rl.ok) return rateLimitResponse(rl.retryAfter);

    const db = await getDb();
    const fm = await requireForeignMinister(
      countryId,
      auth.user.character._id,
      auth.user.character.name,
      db
    );
    if (!fm.ok) return fm.response;

    const col = await getOrganizationLegislationCollection(db);
    const legislation = await col.findOne({ _id: new ObjectId(legislationId) });
    if (!legislation) {
      return NextResponse.json(notFound("Legislation not found").toJson(), { status: 404 });
    }
    if (legislation.status !== "pending") {
      return NextResponse.json(badRequest("Voting is closed.").toJson(), { status: 400 });
    }
    // Eligibility depends on the resolution type. FTAs are voted only by their
    // named parties (they bind only those countries); every other resolution
    // type is decided by a majority of the host org's members, so any member
    // foreign minister may vote.
    if (legislation.type === "free_trade_agreement") {
      if (!(legislation.parties as CountryId[]).includes(countryId)) {
        return NextResponse.json(
          badRequest(`${countryId} is not a party to this legislation.`).toJson(),
          { status: 400 }
        );
      }
      // Parties are checked against membership when the agreement is tabled, but
      // a country can withdraw, or lose player-enablement, before the vote
      // closes. This gate is the player-enabled roll, which is the right one for
      // an HTTP ballot whatever the instrument: it is a subset of every roll the
      // resolver uses, so a vote accepted here is never one the resolver will
      // discard. An autonomous member's ballot is cast by the turn engine, not
      // through this route.
      if (!(await isVotingMember(db, legislation.organizationId, countryId))) {
        return NextResponse.json(
          badRequest(`${countryId} has no vote in ${legislation.organizationId}.`).toJson(),
          { status: 400 }
        );
      }
    } else if (!(await isVotingMember(db, legislation.organizationId, countryId))) {
      return NextResponse.json(
        badRequest(`${countryId} has no vote in ${legislation.organizationId}.`).toJson(),
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
    const updateResult = await upsertPendingOrganizationVote(col, legislation._id, newVote);
    if (updateResult.matchedCount === 0) {
      return NextResponse.json(badRequest("Voting is closed.").toJson(), { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
