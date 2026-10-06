import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import { findCaucusBySlug } from "@/lib/db/caucusLookup";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { CaucusPolicyPosition, Character } from "@/lib/db/types";
import { isSameCountry } from "@/lib/api/sameCountry";

const updateSchema = z.object({
  topic: z.string().trim().min(2).max(80).optional(),
  stance: z.string().trim().min(1).max(80).optional(),
  note: z.string().trim().max(280).optional(),
  weight: z.enum(["core", "secondary"]).optional(),
  sortOrder: z.number().int().min(0).max(100).optional(),
});

interface RouteParams {
  params: Promise<{ code: string; id: string; slug: string; positionId: string }>;
}

async function loadChairContext(
  code: string,
  id: string,
  slug: string,
  character: Pick<Character, "_id" | "countryId">
) {
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { error: errorResponse(400, "Invalid country code") };
  }
  const db = await getDb();
  const party = await findPartyBySequentialId(db, id, countryId);
  if (!party) {
    return { error: errorResponse(404, "Party not found") };
  }
  const partyId = String(party.sequentialId);
  const resolved = await findCaucusBySlug(db, countryId, partyId, slug);
  if (!resolved) {
    return { error: errorResponse(404, "Caucus not found") };
  }
  if (!resolved.caucus.chairId || resolved.caucus.chairId.toString() !== character._id.toString()) {
    return {
      error: errorResponse(403, "Only the caucus chair can edit policy positions."),
    };
  }
  if (!isSameCountry(character, { countryId })) {
    return {
      error: errorResponse(
        403,
        "You must be a citizen of this country to edit caucus policy positions."
      ),
    };
  }
  return { db, caucus: resolved.caucus };
}

// PATCH /api/country/[code]/parties/[id]/caucuses/[slug]/positions/[positionId] — Edit a position
// Auth: requireAuthWithCharacter (must be the chair)
// Errors: 400, 401, 403, 404
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { code, id, slug, positionId } = await params;
    if (!ObjectId.isValid(positionId)) {
      return errorResponse(400, "Invalid position id");
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, updateSchema);
    if (!parsed.success) {
      return errorResponse(parsed.status, parsed.error);
    }

    const ctx = await loadChairContext(code, id, slug, auth.user.character);
    if ("error" in ctx) return ctx.error;
    const { db, caucus } = ctx;

    const now = new Date();
    const updates: Partial<CaucusPolicyPosition> = { updatedAt: now };
    if (parsed.data.topic !== undefined) updates.topic = parsed.data.topic;
    if (parsed.data.stance !== undefined) updates.stance = parsed.data.stance;
    if (parsed.data.note !== undefined) updates.note = parsed.data.note;
    if (parsed.data.weight !== undefined) updates.weight = parsed.data.weight;
    if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;

    const result = await db
      .collection<CaucusPolicyPosition>("caucusPolicyPositions")
      .updateOne({ _id: new ObjectId(positionId), caucusId: caucus._id }, { $set: updates });
    if (result.matchedCount === 0) {
      return errorResponse(404, "Position not found");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/country/[code]/parties/[id]/caucuses/[slug]/positions/[positionId] — Remove a position
// Auth: requireAuthWithCharacter (must be the chair)
// Errors: 400, 401, 403, 404
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { code, id, slug, positionId } = await params;
    if (!ObjectId.isValid(positionId)) {
      return errorResponse(400, "Invalid position id");
    }

    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const ctx = await loadChairContext(code, id, slug, auth.user.character);
    if ("error" in ctx) return ctx.error;
    const { db, caucus } = ctx;

    const result = await db
      .collection<CaucusPolicyPosition>("caucusPolicyPositions")
      .deleteOne({ _id: new ObjectId(positionId), caucusId: caucus._id });
    if (result.deletedCount === 0) {
      return errorResponse(404, "Position not found");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
