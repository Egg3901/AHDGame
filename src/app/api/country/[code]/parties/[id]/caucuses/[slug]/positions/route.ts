import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug, listCaucusPositions } from "@/lib/db/caucusLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CaucusPolicyPosition } from "@/lib/db/types";
import { isSameCountry } from "@/lib/api/sameCountry";

const createSchema = z.object({
  topic: z.string().trim().min(2).max(80),
  stance: z.string().trim().min(1).max(80),
  note: z.string().trim().max(280).optional(),
  weight: z.enum(["core", "secondary"]).default("secondary"),
});

// POST /api/country/[code]/parties/[id]/caucuses/[slug]/positions — Add a policy position
// Auth: requireAuthWithCharacter (must be the chair)
// Errors: 400, 401, 403, 404
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string; slug: string }> }
) {
  try {
    const { code, id, slug } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 400 });
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, createSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyId = String(party.sequentialId);

    const resolved = await findCaucusBySlug(db, countryId, partyId, slug);
    if (!resolved) {
      return NextResponse.json({ error: "Caucus not found" }, { status: 404 });
    }
    const { caucus } = resolved;

    if (!caucus.chairId || caucus.chairId.toString() !== auth.user.character._id.toString()) {
      return NextResponse.json(
        { error: "Only the caucus chair can add policy positions." },
        { status: 403 }
      );
    }
    if (!isSameCountry(auth.user.character, { countryId })) {
      return NextResponse.json(
        { error: "You must be a citizen of this country to manage caucus policy positions." },
        { status: 403 }
      );
    }

    // sortOrder defaults to count + 1 so new positions append to the bottom.
    const existing = await listCaucusPositions(db, caucus._id);
    const sortOrder = existing.length;

    const now = new Date();
    const positionId = new ObjectId();
    await db.collection<CaucusPolicyPosition>("caucusPolicyPositions").insertOne({
      _id: positionId,
      caucusId: caucus._id,
      topic: parsed.data.topic,
      stance: parsed.data.stance,
      note: parsed.data.note?.trim() ?? "",
      weight: parsed.data.weight,
      sortOrder,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      success: true,
      position: {
        id: positionId.toString(),
        topic: parsed.data.topic,
        stance: parsed.data.stance,
        note: parsed.data.note?.trim() ?? "",
        weight: parsed.data.weight,
        sortOrder,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
