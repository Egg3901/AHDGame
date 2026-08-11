import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { parseJsonBody, schemas } from "@/lib/api/validate";
import { handleRouteError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import {
  autoGenerateLandesliste,
  getLandesliste,
  reorderLandesliste,
} from "@/lib/elections/germanyLandesliste";
import type { CountryId } from "@/lib/constants/countries";

interface RouteParams {
  params: Promise<{ code: string; id: string; landId: string }>;
}

const reorderSchema = z.object({
  cycle: z.number().int().nonnegative(),
  /** Full replacement list — must contain all intended candidates in final order. */
  candidates: z.array(schemas.objectId).min(0).max(500),
});

function parseCycle(request: Request): number | null {
  const url = new URL(request.url);
  const raw = url.searchParams.get("cycle");
  if (raw == null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// GET /api/country/[code]/parties/[id]/landesliste/[landId] — Fetch a party's Landesliste for a given cycle
// Auth: requireAuthWithCharacter
// Errors: 400, 401, 404
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { code, id: partyId, landId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (countryId !== "DE") {
      return NextResponse.json(badRequest("Landesliste is a German-only concept").toJson(), {
        status: 400,
      });
    }

    const cycle = parseCycle(request);
    if (cycle == null) {
      return NextResponse.json(badRequest("cycle query param is required").toJson(), {
        status: 400,
      });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, "DE");
    if (!party) {
      return NextResponse.json(notFound("Party not found").toJson(), { status: 404 });
    }

    const list = await getLandesliste(db, { partyId: String(party.sequentialId), landId, cycle });
    return NextResponse.json({
      success: true,
      landesliste: list,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

// PUT /api/country/[code]/parties/[id]/landesliste/[landId] — Reorder or replace a Landesliste (chair-only)
// Auth: requireAuthWithCharacter (party chair or vice chair)
// Errors: 400, 401, 403, 404
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const { code, id: partyId, landId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (countryId !== "DE") {
      return NextResponse.json(badRequest("Landesliste is a German-only concept").toJson(), {
        status: 400,
      });
    }

    const parsed = await parseJsonBody(request, reorderSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const party = await findPartyBySequentialId(db, partyId, "DE");
    if (!party) {
      return NextResponse.json(notFound("Party not found").toJson(), { status: 404 });
    }

    const characterId = auth.user.character._id;
    const isChair = party.chairId?.equals(characterId);
    const isViceChair = party.viceChairId?.equals(characterId);
    if (!isChair && !isViceChair) {
      return NextResponse.json(
        forbidden("Only the party chair or vice chair can edit the Landesliste").toJson(),
        { status: 403 }
      );
    }

    // Ensure a base list exists so the reorder has something to operate on —
    // auto-generate on first edit (preserving any existing unlocked list).
    await autoGenerateLandesliste(db, {
      partyId: String(party.sequentialId),
      landId,
      cycle: parsed.data.cycle,
      preserveExisting: true,
    });

    const candidateOids = parsed.data.candidates.map((s) => new ObjectId(s));
    try {
      const updated = await reorderLandesliste(db, {
        partyId: String(party.sequentialId),
        landId,
        cycle: parsed.data.cycle,
        candidates: candidateOids,
        authoredBy: characterId,
      });
      return NextResponse.json({ success: true, landesliste: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid Landesliste update";
      return NextResponse.json(badRequest(msg).toJson(), { status: 400 });
    }
  } catch (error) {
    return handleRouteError(error);
  }
}
