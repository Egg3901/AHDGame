import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { Character } from "@/lib/db/types/character";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";

const acceptSchema = z.object({
  partySequentialId: z.number().int().positive(),
});

// POST /api/coalitions/[id]/join/accept — Accept a join request (coalition chair only)
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

    const parsed = await parseJsonBody(request, acceptSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();

    // Find coalition, verify caller is coalition chair
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: Number(id), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    if (!coalition.chairCharacterId || !coalition.chairCharacterId.equals(character._id)) {
      throw forbidden("Only the coalition chair can accept join requests.");
    }

    // Find the requesting party
    const requestingParty = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: parsed.data.partySequentialId, countryId });
    if (!requestingParty) {
      throw notFound("Requesting party not found.");
    }

    // Verify the party has a pending request in this coalition
    const joinRequest = coalition.joinRequests.find(
      (r) => String(r.partyId) === String(requestingParty._id)
    );
    if (!joinRequest) {
      throw badRequest("That party does not have a pending join request to this coalition.");
    }

    // Defense-in-depth: a banned party may not join a coalition. The /join
    // route already gates the requester at submission time; this is the
    // symmetric guard on the chair's accept so a banned party can't slip in
    // via a stale request after its regime status changed.
    // Runtime governmentType so a post-Stage-4 conversion immediately
    // lifts the banned-party restriction.
    const runtime = await getCountryState(db, countryId);
    if (isBannedParty({ governmentType: runtime.governmentType }, requestingParty)) {
      throw forbidden("That party is banned and cannot be admitted to a coalition.");
    }

    // Reject if the requesting party joined a different coalition after submitting the request.
    // The /join request guard only checks at request time; without re-checking here, acceptance
    // overwrites coalitionId and leaves the party stale-listed in the prior coalition.
    if (requestingParty.coalitionId && !requestingParty.coalitionId.equals(coalition._id)) {
      throw badRequest("That party is already a member of another coalition.");
    }

    // Check if party is already a member (should not happen, but prevents duplicates)
    const isAlreadyMember = coalition.members.some((m) => m.partyId.equals(requestingParty._id));
    if (isAlreadyMember) {
      // Remove from joinRequests and return success
      // $pull with nested object filter hits a TypeScript limitation in MongoDB's UpdateFilter
      /* eslint-disable @typescript-eslint/no-explicit-any */
      await db.collection("coalitions").updateOne({ _id: coalition._id }, {
        $pull: { joinRequests: { partyId: requestingParty._id } },
        $set: { updatedAt: new Date() },
      } as any);
      /* eslint-enable @typescript-eslint/no-explicit-any */
      return NextResponse.json({ success: true });
    }

    const now = new Date();

    // Use a pipeline update to atomically move party from joinRequests to members.
    await db.collection("coalitions").updateOne({ _id: coalition._id }, [
      {
        $set: {
          joinRequests: {
            $filter: {
              input: "$joinRequests",
              as: "req",
              cond: { $ne: ["$$req.partyId", requestingParty._id] },
            },
          },
          members: {
            $concatArrays: [
              "$members",
              [
                {
                  partyId: requestingParty._id,
                  partySequentialId: requestingParty.sequentialId,
                  joinedAt: now,
                },
              ],
            ],
          },
          updatedAt: now,
        },
      },
    ]);

    // Set coalitionId on the party
    await db
      .collection<PoliticalParty>("politicalParties")
      .updateOne(
        { _id: requestingParty._id },
        { $set: { coalitionId: coalition._id, updatedAt: now } }
      );

    // Notify the requesting party's chair
    if (requestingParty.chairId) {
      const chairChar = await db
        .collection<Character>("characters")
        .findOne({ _id: requestingParty.chairId }, { projection: { userId: 1 } });
      if (chairChar) {
        await createNotification({
          userId: chairChar.userId,
          type: "coalition_join_accepted",
          title: `Join Request Accepted: ${coalition.name}`,
          message: `Your party has been accepted into the coalition "${coalition.name}".`,
          metadata: {
            coalitionId: coalition._id,
            coalitionSequentialId: coalition.sequentialId,
            coalitionName: coalition.name,
            countryId,
            partyName: requestingParty.name,
          },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
