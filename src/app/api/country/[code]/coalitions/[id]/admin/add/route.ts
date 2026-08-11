import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import type { Coalition, CoalitionMember } from "@/lib/db/types/coalition";
import type { PoliticalParty } from "@/lib/db/types/party";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { isBannedParty } from "@/lib/turn/onePartyConstraints";
import { getCountryState } from "@/lib/countryState";

const addPartySchema = z.object({
  partySequentialId: z.number().int().positive(),
});

// POST /api/coalitions/[id]/admin/add?country= — Admin: add a party to a coalition
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

    const parsed = await parseJsonBody(request, addPartySchema);
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

    if (party.coalitionId) {
      throw badRequest("This party is already a member of a coalition.");
    }

    // Defense-in-depth: even admin-add cannot bypass the banned-party gate.
    // If the regime status needs to change, the admin should flip it via the
    // regime-status endpoint first (which goes through processUnbanPartyEffects).
    // Runtime governmentType so a post-Stage-4 conversion immediately
    // lifts the banned-party restriction.
    const runtime = await getCountryState(db, countryId);
    if (isBannedParty({ governmentType: runtime.governmentType }, party)) {
      throw forbidden("Banned parties cannot be added to a coalition. Unban the party first.");
    }

    // Check if party is already in the coalition members (should not happen, but prevents duplicates)
    const isAlreadyMember = coalition.members.some((m) => m.partyId.equals(party._id));
    if (isAlreadyMember) {
      return NextResponse.json({ success: true, message: "Party is already a member." });
    }

    const now = new Date();
    const newMember: CoalitionMember = {
      partyId: party._id,
      partySequentialId: party.sequentialId,
      joinedAt: now,
    };

    await Promise.all([
      db
        .collection<Coalition>("coalitions")
        .updateOne(
          { _id: coalition._id },
          { $push: { members: newMember }, $set: { updatedAt: now } }
        ),
      db
        .collection<PoliticalParty>("politicalParties")
        .updateOne({ _id: party._id }, { $set: { coalitionId: coalition._id, updatedAt: now } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
