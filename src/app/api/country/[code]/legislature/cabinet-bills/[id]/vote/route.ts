// POST /api/country/[code]/legislature/cabinet-bills/[id]/vote — vote on a cabinet bill
// Auth: requireAuthWithCharacter (PM or player-held cabinet position)
// Error codes: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { COUNTRY_CONFIGS, getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { checkLegislationFreeze } from "@/lib/api/parliamentaryFreeze";
import { ObjectId } from "mongodb";
import type { Bill } from "@/lib/db/types";
import { z } from "zod";

const cabinetVoteSchema = z.object({
  vote: z.enum(["for", "against"]),
});

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

    const config = getCountryConfig(countryId);
    if (!config.cabinetBillsEnabled) {
      return NextResponse.json(
        badRequest("Cabinet bills are not enabled for this country").toJson(),
        { status: 400 }
      );
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;
    const { character } = auth.user;

    // S#17 legislation freeze: block cabinet votes while gov is pending.
    const freezeCheck = await checkLegislationFreeze(countryId);
    if (!freezeCheck.ok) return freezeCheck.response;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json(badRequest("Invalid bill ID").toJson(), { status: 400 });
    }

    const db = await getDb();

    // Find the cabinet bill
    const bill = await db
      .collection<Bill>("bills")
      .findOne({ _id: new ObjectId(id), countryId, status: "cabinet_review" });
    if (!bill) {
      return NextResponse.json(notFound("Cabinet bill not found or not in review").toJson(), {
        status: 404,
      });
    }

    // Check voter is PM or player-held cabinet member
    const gov = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
    const isPM = gov?.pmCharacterId?.toString() === character._id.toString();

    const cabinetMember = !isPM
      ? await db.collection("cabinetMembers").findOne({ characterId: character._id, countryId })
      : null;

    if (!isPM && !cabinetMember) {
      return NextResponse.json(
        forbidden("Only the PM or cabinet members can vote on cabinet bills").toJson(),
        { status: 403 }
      );
    }

    // Parse vote
    const parsed = await parseJsonBody(request, cabinetVoteSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { vote } = parsed.data;

    // Check if already voted
    const voteKey = character._id.toString();
    if (bill.votes[voteKey]) {
      return NextResponse.json(badRequest("You have already voted on this bill").toJson(), {
        status: 400,
      });
    }

    // Cast vote
    const incField = vote === "for" ? "votesFor" : "votesAgainst";
    const voteResult = await db.collection<Bill>("bills").updateOne(
      {
        _id: bill._id,
        status: "cabinet_review",
        [`votes.${voteKey}`]: { $exists: false },
      },
      {
        $set: { [`votes.${voteKey}`]: vote, updatedAt: new Date() },
        $inc: { [incField]: 1 },
      }
    );
    if (voteResult.modifiedCount === 0) {
      return NextResponse.json(badRequest("You have already voted on this bill").toJson(), {
        status: 400,
      });
    }

    return NextResponse.json({ success: true, vote });
  } catch (error) {
    return handleRouteError(error);
  }
}
