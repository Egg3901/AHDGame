import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, notFound } from "@/lib/api/errors";
import type { Coalition } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";

const appointChairSchema = z.object({
  partySequentialId: z.number().int().positive(),
});

// POST /api/coalitions/[id]/admin/chair?country= — Admin: appoint a coalition chair
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

    const parsed = await parseJsonBody(request, appointChairSchema);
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

    // Verify target is a current member
    const isMember = coalition.members.some((m) => String(m.partyId) === String(party._id));
    if (!isMember) {
      throw badRequest("The target party is not a member of this coalition.");
    }

    const now = new Date();

    await db.collection<Coalition>("coalitions").updateOne(
      { _id: coalition._id },
      {
        $set: {
          chairPartyId: party._id,
          ...(party.chairId ? { chairCharacterId: party.chairId } : {}),
          updatedAt: now,
        },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
