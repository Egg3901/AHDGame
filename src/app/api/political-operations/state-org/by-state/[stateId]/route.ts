import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, badRequest } from "@/lib/api/errors";
import { ELECTORAL_VOTE_UNITS } from "@/lib/constants/states";
import { loadUsPoliticalStateIds } from "@/lib/elections/usPoliticalHome";
import { isUsResidentPoliticalRegion } from "@/lib/elections/statehoodAdmission";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { loadCampaignFxRate } from "@/lib/currency/campaignFxRate";
import { statePresenceNextCost } from "@/lib/campaigns/statePresenceCost";
import type { CharacterStateOrg, Character } from "@/lib/db/types";

const VALID_STATES = new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId));

interface RouteParams {
  params: Promise<{ stateId: string }>;
}

/**
 * GET /api/political-operations/state-org/by-state/[stateId]
 *
 * Returns every character's org level in the requested state, ordered
 * descending. Logged-in read — strategic visibility for opponents in the
 * presidential primary. Excludes rows where level === 0.
 *
 * Also returns the VIEWER's own level and the converted cost of their next one,
 * so the build button on that page quotes the same figure the campaign manager
 * does and the same figure the build route charges. `viewerNextCost` is null
 * for a signed-in user with no character.
 *
 * Auth: requireBasicAuth (any logged-in user; data is intentionally
 *   cross-character but not public-internet readable)
 * Errors: 400 (invalid state), 401 (no auth)
 */
export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { stateId } = await params;
    if (!VALID_STATES.has(stateId)) {
      return NextResponse.json(badRequest("Invalid state").toJson(), { status: 400 });
    }

    const db = await getDb();
    const { admittedIds, preset } = await loadUsPoliticalStateIds(db);
    if (!isUsResidentPoliticalRegion(stateId, preset, admittedIds)) {
      return NextResponse.json(badRequest("Invalid state").toJson(), { status: 400 });
    }

    // The viewer's own standing, which the shared rows below deliberately omit
    // once their level is 0.
    const viewer = await getCharacterByUserId(db, auth.user.userId);
    let viewerLevel = 0;
    let viewerNextCost: number | null = null;
    if (viewer) {
      const own = await db
        .collection<CharacterStateOrg>("characterStateOrg")
        .findOne({ characterId: viewer._id, stateId }, { projection: { level: 1 } });
      viewerLevel = own?.level ?? 0;
      viewerNextCost = statePresenceNextCost(viewerLevel, await loadCampaignFxRate(db, viewer));
    }

    const rows = await db
      .collection<CharacterStateOrg>("characterStateOrg")
      .find({ stateId, level: { $gt: 0 } })
      .toArray();
    if (rows.length === 0) {
      return NextResponse.json({ stateId, candidates: [], viewerLevel, viewerNextCost });
    }

    const charIds = rows.map((r) => r.characterId);
    const chars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: charIds } }, { projection: { _id: 1, name: 1 } })
      .toArray();
    const charMap = new Map(chars.map((c) => [c._id.toString(), c.name]));

    const candidates = rows
      .map((r) => ({
        characterId: r.characterId.toString(),
        characterName: charMap.get(r.characterId.toString()) ?? "(unknown)",
        level: r.level,
      }))
      .sort((a, b) => b.level - a.level);

    return NextResponse.json({ stateId, candidates, viewerLevel, viewerNextCost });
  } catch (error) {
    return handleRouteError(error);
  }
}
