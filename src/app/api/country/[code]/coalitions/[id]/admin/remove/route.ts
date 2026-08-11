import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

const removePartySchema = z.object({
  partySequentialId: z.number().int().positive(),
});

// POST /api/coalitions/[id]/admin/remove?country= — Admin: remove a party from a coalition
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

    const adminResult = await requireAdmin();
    if (!adminResult.ok) return adminResult.response;

    const parsed = await parseJsonBody(request, removePartySchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const { partySequentialId } = parsed.data;

    const db = await getDb();

    const coalition = await db
      .collection<Coalition>("coalitions")
      .findOne({ sequentialId: parseInt(id, 10), countryId });
    if (!coalition) {
      throw notFound("Coalition not found.");
    }

    const party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ sequentialId: partySequentialId, countryId });
    if (!party) {
      throw notFound("Party not found.");
    }

    const isMember = coalition.members.some((m) => String(m.partyId) === String(party._id));
    if (!isMember) {
      throw badRequest("This party is not a member of the coalition.");
    }

    const now = new Date();
    const remainingMembers = coalition.members.filter(
      (m) => String(m.partyId) !== String(party._id)
    );

    if (remainingMembers.length === 0) {
      // Last member — delete the coalition entirely
      await db.collection<Coalition>("coalitions").deleteOne({ _id: coalition._id });
    } else if (String(coalition.chairPartyId) === String(party._id)) {
      // Chair is being removed — promote next most senior member
      const sorted = [...remainingMembers].sort(
        (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()
      );
      const nextMember = sorted[0]!;

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
    } else {
      // Non-chair removal — just pull from members
      await db.collection<Coalition>("coalitions").updateOne(
        { _id: coalition._id },
        {
          $pull: { members: { partyId: party._id } },
          $set: { updatedAt: now },
        }
      );
    }

    // Clear coalitionId on the removed party only if it actually pointed at this coalition.
    // See leave/kick routes for the same conditional-clear rationale.
    if (party.coalitionId && party.coalitionId.equals(coalition._id)) {
      await db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, { $set: { coalitionId: null } });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
