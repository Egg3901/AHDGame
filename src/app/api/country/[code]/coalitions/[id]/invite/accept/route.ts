import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { createNotification } from "@/lib/notifications";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { Character } from "@/lib/db/types/character";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { canActAsChair } from "@/lib/parties/actingChair";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";

// POST /api/coalitions/[id]/invite/accept — Accept a coalition invite
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

    if (!character.party || character.party === "independent") {
      throw badRequest("You must be a member of a party to accept a coalition invite.");
    }

    const db = await getDb();

    // Find coalition
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: Number(id), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Find the character's party
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: Number(character.party), countryId });
    if (!party) {
      throw notFound("Your party could not be found.");
    }

    // Caller must be the party chair
    if (!canActAsChair(party, character._id)) {
      throw forbidden(
        "Only the national party chair (or acting vice-chair) can accept a coalition invite."
      );
    }

    // Defense-in-depth: a banned party may not join a coalition. The /invite
    // route already gates the inviter; this is the symmetric guard on the
    // accepting party so a banned party can't accept a stale invite even if
    // its regime status changed after the invite was sent.
    // Runtime governmentType so a post-Stage-4 conversion immediately
    // lifts the banned-party restriction.
    const runtime = await getCountryState(db, countryId);
    if (isBannedParty({ governmentType: runtime.governmentType }, party)) {
      throw forbidden("Banned parties may not join a coalition in this country.");
    }

    // Verify the party has a pending invite from this coalition
    const invite = coalition.pendingInvites.find(
      (inv) => String(inv.partyId) === String(party._id)
    );
    if (!invite) {
      throw badRequest("Your party does not have a pending invite from this coalition.");
    }

    // Reject if the party joined a different coalition between the invite and the accept.
    // The original invite guard only checks at send time; without re-checking here, accepting
    // overwrites coalitionId and leaves the party as a stale member of the prior coalition.
    if (party.coalitionId && !party.coalitionId.equals(coalition._id)) {
      throw badRequest("Your party is already a member of another coalition.");
    }

    // Check if party is already a member (should not happen, but prevents duplicates)
    const isAlreadyMember = coalition.members.some((m) => m.partyId.equals(party._id));
    if (isAlreadyMember) {
      // Remove from pendingInvites and return success
      // $pull with nested object filter hits a TypeScript limitation in MongoDB's UpdateFilter
      /* eslint-disable @typescript-eslint/no-explicit-any */
      await db.collection("coalitions").updateOne({ _id: coalition._id }, {
        $pull: { pendingInvites: { partyId: party._id } },
        $set: { updatedAt: new Date() },
      } as any);
      /* eslint-enable @typescript-eslint/no-explicit-any */
      return NextResponse.json({ success: true, message: `Already a member of ${coalition.name}` });
    }

    const now = new Date();

    // Use a pipeline update to atomically move party from pendingInvites to members.
    // Avoids mixing $push + $pull in a single classic update (which can fail
    // depending on MongoDB server / driver version).
    await db.collection("coalitions").updateOne({ _id: coalition._id }, [
      {
        $set: {
          pendingInvites: {
            $filter: {
              input: "$pendingInvites",
              as: "inv",
              cond: { $ne: ["$$inv.partyId", party._id] },
            },
          },
          members: {
            $concatArrays: [
              "$members",
              [
                {
                  partyId: party._id,
                  partySequentialId: party.sequentialId,
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
      .updateOne({ _id: party._id }, { $set: { coalitionId: coalition._id, updatedAt: now } });

    // Notify coalition chair
    const chairChar = coalition.chairCharacterId
      ? await db
          .collection<Character>("characters")
          .findOne({ _id: coalition.chairCharacterId }, { projection: { userId: 1 } })
      : null;
    if (chairChar) {
      await createNotification({
        userId: chairChar.userId,
        type: "coalition_invite_accepted",
        title: `Invite Accepted: ${party.name}`,
        message: `${party.name} has accepted your invitation to join "${coalition.name}".`,
        metadata: {
          coalitionId: coalition._id,
          coalitionSequentialId: coalition.sequentialId,
          coalitionName: coalition.name,
          partyId: party._id,
          partyName: party.name,
          countryId,
        },
      });
    }

    return NextResponse.json({ success: true, message: `Joined ${coalition.name}` });
  } catch (error) {
    return handleRouteError(error);
  }
}
