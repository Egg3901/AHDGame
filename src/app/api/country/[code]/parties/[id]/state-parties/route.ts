import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { findPartyBySequentialId } from "@/lib/db/partyLookup";
import type { State, StatePartyOrg, NPP, Character } from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getStateLean } from "@/lib/utils/demographics";
import { buildStatePartyRows } from "@/lib/states/buildStatePartyRows";

// GET /api/country/[code]/parties/[id]/state-parties — Aggregate per-region party data
//   (org%, PS, treasury, registration%, lean, chair, NPP count, priority target) for the
//   National HQ surface.
// Auth: requireAuthWithCharacter — party member / chair / vice / admin (read-only).
// Errors: 400, 401, 403, 404
export async function GET(
  _request: Request,
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
    const auth = authResult.user;

    const db = await getDb();
    const party = await findPartyBySequentialId(db, id, countryId);
    if (!party) {
      return NextResponse.json({ error: "Party not found" }, { status: 404 });
    }
    const partyIdStr = String(party.sequentialId);

    // Read-only aggregate — any same-party member (or chair/VC/admin) may view.
    const charId = auth.character._id.toString();
    const isMember = (auth.character as { party?: string }).party === partyIdStr;
    const isChair = party.chairId?.toString() === charId;
    const isViceChair = party.viceChairId?.toString() === charId;
    if (!auth.isAdmin && !isMember && !isChair && !isViceChair) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const states = await db.collection<State>("states").find({ countryId }).toArray();
    const orgRows = await db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ partyId: partyIdStr, countryId })
      .toArray();

    const nppAgg = await db
      .collection<NPP>("npps")
      .aggregate<{ _id: string; count: number }>([
        { $match: { party: partyIdStr, retiredAt: null } },
        { $group: { _id: "$homeState", count: { $sum: 1 } } },
      ])
      .toArray();
    const nppCountByState: Record<string, number> = {};
    for (const a of nppAgg) nppCountByState[a._id] = a.count;

    const chairIds = orgRows
      .map((o) => o.chairId)
      .filter((c): c is NonNullable<typeof c> => c != null);
    const chairs = chairIds.length
      ? await db
          .collection<Character>("characters")
          .find({ _id: { $in: chairIds } })
          .toArray()
      : [];
    const chairNameById: Record<string, string> = {};
    for (const c of chairs) chairNameById[c._id.toString()] = c.name;

    const targetStateIds = party.priorityRegion?.stateIds ?? [];

    const leanByState: Record<string, number> = {};
    for (const s of states) leanByState[s._id] = getStateLean(s, s._id);

    const rows = buildStatePartyRows({
      states: states.map((s) => ({ _id: s._id, name: s.name })),
      orgRows: orgRows.map((o) => ({
        stateId: o.stateId,
        organization: o.organization,
        politicalStrength: o.politicalStrength,
        treasury: o.treasury,
        registration: o.registration,
        chairId: o.chairId ? o.chairId.toString() : null,
        hasPresence: o.hasPresence,
      })),
      nppCountByState,
      chairNameById,
      targetStateIds,
      leanByState,
    });

    return NextResponse.json({ rows });
  } catch (error) {
    return handleRouteError(error);
  }
}
