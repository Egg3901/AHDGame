/**
 * POST /api/admin/country/[code]/parties/[partyId]/appoint — Admin direct appointment of national party leadership
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { PoliticalParty, Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { z } from "zod";

const POSITION_FIELD = {
  chair: "chairId",
  viceChair: "viceChairId",
  treasurer: "treasurerId",
} as const;

const appointSchema = z.object({
  position: z.enum(["chair", "viceChair", "treasurer"]),
  characterId: z.union([z.string().length(24), z.null()]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; partyId: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code, partyId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const parsed = await parseJsonBody(request, appointSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { position, characterId } = parsed.data;

    const db = await getDb();
    const now = new Date();

    // Check party exists using country-scoped lookup
    const party = await findPartyBySequentialId(db, partyId, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }

    // If characterId provided, verify they are a party member AND in the same country
    const partyIdStr = String(party.sequentialId ?? partyId);
    const partyCountryId = party.countryId ?? "US";
    let characterName: string | undefined;
    if (characterId) {
      const character = await db.collection<Character>("characters").findOne({
        _id: new ObjectId(characterId),
        party: partyIdStr,
        countryId: partyCountryId,
      });
      if (!character) {
        return NextResponse.json(
          { error: "Character not found or not in this party" },
          { status: 400 }
        );
      }
      characterName = character.name;
    }

    // Elections continue running - winner will take position when election completes

    const field = POSITION_FIELD[position];
    const leadershipReset: Partial<
      Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">
    > = {};
    if (characterId) {
      const appointedId = new ObjectId(characterId);
      for (const [otherPosition, otherField] of Object.entries(POSITION_FIELD) as Array<
        [keyof typeof POSITION_FIELD, (typeof POSITION_FIELD)[keyof typeof POSITION_FIELD]]
      >) {
        if (otherPosition === position) continue;
        if (party[otherField]?.equals(appointedId)) {
          leadershipReset[otherField] = null;
        }
      }
    }

    // Update the party
    await db.collection<PoliticalParty>("politicalParties").updateOne(
      { _id: party._id },
      {
        $set: {
          ...leadershipReset,
          [field]: characterId ? new ObjectId(characterId) : null,
          updatedAt: now,
        },
      }
    );

    const positionLabel = getPartyRoleLabel(partyCountryId, position);

    return NextResponse.json({
      success: true,
      message: characterId
        ? `Appointed ${characterName} as ${positionLabel}`
        : `${positionLabel} position vacated`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
