// Shared authorization for the battle surfaces (declare an offensive, forecast one).
// Route files may only export HTTP handlers, so these live here rather than being
// imported route-to-route.
import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getGameStateCollection } from "@/lib/db/collections/gameState";
import { getMilitaryFormations } from "@/lib/db/collections/militaryFormations";
import { theaterCommanderOf } from "@/lib/military/assignments";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";

export type BattleAuthzResult =
  | { error: NextResponse; db?: undefined }
  | {
      error?: undefined;
      db: Db;
      countryId: CountryId;
      currentTurn: number;
      characterId: string | null;
      isHolder: boolean;
      isAdmin: boolean;
    };

/**
 * Shared gate: auth + valid country + defense seat + conflictsEnabled.
 *
 * Deliberately does NOT reject a non-holder. Authority over a Conflict is
 * per-theater and can only be decided once the theater is known: where a Theater
 * Commander is designated, they hold it — and they are usually a general rather
 * than the defense holder, so rejecting non-holders here would lock the TC out of
 * their own front. Callers resolve authority via `canActAtTheater`.
 */
export async function authorizeBattleAction(
  params: Promise<{ code: string; positionId: string }>
): Promise<BattleAuthzResult> {
  const auth = await requireAuth();
  if (!auth.ok) return { error: auth.response };

  const { code, positionId } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) {
    return { error: NextResponse.json({ error: "Invalid country" }, { status: 400 }) };
  }
  if (DEFENSE_POSITION_BY_COUNTRY[countryId] !== positionId) {
    return {
      error: NextResponse.json({ error: "Not a defense cabinet position" }, { status: 404 }),
    };
  }

  const db = await getDb();
  const gs = await (
    await getGameStateCollection(db)
  ).findOne({ _id: "current" }, { projection: { conflictsEnabled: 1, currentTurn: 1 } });
  if (!gs?.conflictsEnabled) {
    return { error: NextResponse.json({ error: "Conflicts subsystem disabled" }, { status: 404 }) };
  }

  const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
  const isHolder = Boolean(
    member?.characterId &&
    auth.user.character &&
    member.characterId.toString() === auth.user.character._id.toString()
  );

  return {
    db,
    countryId,
    currentTurn: gs.currentTurn ?? 0,
    characterId: auth.user.character?._id?.toString() ?? null,
    isHolder,
    isAdmin: Boolean(auth.user.isAdmin),
  };
}

/**
 * Who may act on offensives at a Conflict.
 *
 * Once a Theater Commander is designated there, the front is theirs — the defense
 * holder has delegated it and can no longer declare over their head. Until then,
 * the defense holder retains authority. Admin always retains the escape hatch.
 */
export async function canActAtTheater(
  db: Db,
  countryId: CountryId,
  theaterId: string,
  caller: { characterId: string | null; isHolder: boolean; isAdmin: boolean }
): Promise<NextResponse | null> {
  if (caller.isAdmin) return null;
  const { conflictAssignments } = await getMilitaryFormations(db, countryId);
  const tc = theaterCommanderOf(conflictAssignments, theaterId);
  if (tc) {
    return tc === caller.characterId
      ? null
      : NextResponse.json(
          { error: "Only the theater commander may act on this conflict" },
          { status: 403 }
        );
  }
  return caller.isHolder
    ? null
    : NextResponse.json(
        { error: "Only the defense holder or admin can declare offensives" },
        { status: 403 }
      );
}
