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

// POST /api/coalitions/[id]/leave?country= — Leave a coalition
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

    const db = await getDb();

    // Find the user's party
    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: Number(character.party), countryId });
    if (!party) {
      throw notFound("Your party was not found.");
    }

    // Verify the caller is the national chair of that party
    if (!canActAsChair(party, character._id)) {
      throw forbidden(
        "Only the national chair (or acting vice-chair) can leave a coalition on behalf of the party."
      );
    }

    // Find coalition
    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: Number(id), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    // Verify party is a member
    const isMember = coalition.members.some((m) => String(m.partyId) === String(party._id));
    if (!isMember) {
      throw badRequest("Your party is not a member of this coalition.");
    }

    const now = new Date();
    const isChairParty = String(coalition.chairPartyId) === String(party._id);
    const remainingMembers = coalition.members.filter(
      (m) => String(m.partyId) !== String(party._id)
    );

    if (remainingMembers.length === 0) {
      // Last member — delete the coalition entirely
      await db.collection<Coalition>("coalitions").deleteOne({ _id: coalition._id });
    } else if (isChairParty) {
      // Chair leaves with others remaining — promote next most senior member
      const sorted = [...remainingMembers].sort(
        (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()
      );
      const nextMember = sorted[0]!;

      // Look up new chair party to get their national chair character
      const newChairParty = await db
        .collection<PoliticalParty>("politicalParties")
        .findOne({ _id: nextMember.partyId });

      const newChairCharacterId = newChairParty?.chairId ?? null;

      await db.collection<Coalition>("coalitions").updateOne(
        { _id: coalition._id },
        {
          $pull: { members: { partyId: party._id } },
          $set: {
            chairPartyId: nextMember.partyId,
            ...(newChairCharacterId ? { chairCharacterId: newChairCharacterId } : {}),
            updatedAt: now,
          },
        }
      );

      // Notify new chair
      if (newChairCharacterId) {
        const newChairChar = await db
          .collection<Character>("characters")
          .findOne({ _id: newChairCharacterId }, { projection: { userId: 1 } });
        if (newChairChar) {
          await createNotification({
            userId: newChairChar.userId,
            type: "coalition_chair_transferred",
            title: `You are now Coalition Chair: ${coalition.name}`,
            message: `Your party has become the new chair of the coalition "${coalition.name}" after the previous chair left.`,
            metadata: {
              coalitionId: coalition._id,
              coalitionSequentialId: coalition.sequentialId,
              coalitionName: coalition.name,
              countryId,
            },
          });
        }
      }
    } else {
      // Non-chair leaves — just remove from members
      await db.collection<Coalition>("coalitions").updateOne(
        { _id: coalition._id },
        {
          $pull: { members: { partyId: party._id } },
          $set: { updatedAt: now },
        }
      );
    }

    // Clear coalitionId on the leaving party only if it actually pointed at this coalition.
    // If coalitionId points elsewhere (data corruption — see invite/accept + join/accept gaps
    // pre-fix), clearing it would orphan the party from the coalition it really belongs to.
    if (party.coalitionId && party.coalitionId.equals(coalition._id)) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, { $set: { coalitionId: null } });
    }

    return NextResponse.json({ success: true, message: `Left ${coalition.name}` });
  } catch (error) {
    return handleRouteError(error);
  }
}
