/**
 * POST /api/admin/country/[code]/region/[id]/remove-official
 * Admin: remove an official from a seat in a region.
 * Moved from /api/admin/state/[id]/remove-official.
 */
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { adminRemoveOfficialSchema } from "@/lib/api/schemas/admin";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { ElectedOfficial, Character, NPP } from "@/lib/db/types";
import { handleRouteError } from "@/lib/api/errors";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    const stateId = id;

    const parsed = await parseJsonBody(request, adminRemoveOfficialSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { officialId } = parsed.data;

    const db = await getDb();
    const now = new Date();

    // Find the official
    const official = await db.collection<ElectedOfficial>("electedOfficials").findOne({
      _id: new ObjectId(officialId),
      state: stateId,
    });

    if (!official) {
      return NextResponse.json({ error: "Official not found" }, { status: 404 });
    }

    const characterName = official.characterName ?? "Unknown";
    const officeType = official.officeType;

    // Clear the character/NPP's currentOffice
    if (official.characterId) {
      await db
        .collection<Character>("characters")
        .updateOne({ _id: official.characterId }, { $unset: { currentOffice: "" } });
    } else if (official.nppId) {
      await db
        .collection<NPP>("npps")
        .updateOne({ _id: official.nppId }, { $unset: { currentOffice: "" } });
    }

    // Clear the official record (set to vacant)
    await db.collection<ElectedOfficial>("electedOfficials").updateOne(
      { _id: official._id },
      {
        $set: {
          characterId: null,
          isNPP: false,
          updatedAt: now,
        },
        $unset: {
          nppId: "",
          characterName: "",
          party: "",
        },
      }
    );

    const officeLabel =
      officeType === "senate"
        ? `Senator (Class ${official.senateClass})`
        : officeType === "house"
          ? "House Representative"
          : officeType === "governor"
            ? "Governor"
            : officeType === "stateSenate"
              ? "State Senator"
              : officeType === "landtag"
                ? "Member of Landtag"
                : officeType === "regionalCouncil"
                  ? "Regional Councillor"
                  : officeType === "npcDelegate"
                    ? "NPC Delegate"
                    : officeType === "peoplesCongress"
                      ? "People's Congress Delegate"
                      : officeType;

    return NextResponse.json({
      success: true,
      message: `${characterName} removed from ${officeLabel} position`,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
