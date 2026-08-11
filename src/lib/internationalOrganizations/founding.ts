import type { Db } from "mongodb";
import type { InternationalOrganizationDef } from "@/lib/constants/internationalOrganizations";
import type { OrgMemberId } from "@/lib/db/types/internationalOrganization";
import type { GameState } from "@/lib/db/types/gameState";
import { resolveGameYear } from "@/lib/era/era";
import { getOrganizationMembershipsCollection } from "@/lib/db/collections";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Founding-year existence for international organizations. An org founded
 * after the game's live year does not exist yet: not seeded, hidden from the
 * world list, not joinable. Existence is DERIVED (no persisted founding
 * records): def.foundedYear vs the live game year, with a has-presence
 * override so a year rollback can't vanish a populated org.
 *
 * NOTE: must not import from ./service — service imports this module.
 */

export interface OrgFoundingContext {
  /** Live in-game year; null = era-awareness unavailable (legacy gameState). */
  liveYear: number | null;
  /** Active reset preset id; "2019-default" when unset (legacy rows). */
  preset: string;
}

export async function loadOrgFoundingContext(db: Db): Promise<OrgFoundingContext> {
  const gs = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { projection: { currentYear: 1, currentTurn: 1, startingYear: 1, preset: 1 } }
    );
  return {
    liveYear: gs ? resolveGameYear(gs) : null,
    preset: gs?.preset ?? DEFAULT_SEED_PRESET,
  };
}

export function isOrganizationFounded(params: {
  def: Pick<InternationalOrganizationDef, "foundedYear" | "dissolvedYear">;
  liveYear: number | null;
  hasMembers: boolean;
}): boolean {
  const { def, liveYear, hasMembers } = params;
  if (def.foundedYear == null) return true; // custom orgs & unset built-ins
  // No forced history: a populated org never vanishes on year math. Member
  // presence ONLY — a leadership row alone doesn't count, so a dissolved-year
  // org emptied by withdrawals past its dissolution vanishes for good.
  if (hasMembers) return true;
  if (liveYear == null) return true; // legacy gameState → legacy behavior
  if (liveYear < def.foundedYear) return false;
  return def.dissolvedYear == null || liveYear < def.dissolvedYear;
}

/** Seed-time member roster for a preset: era override ?? default founders. */
export function resolveSeedRoster(
  def: Pick<InternationalOrganizationDef, "foundingMembers" | "foundingMembersByEra">,
  preset: string
): OrgMemberId[] {
  return def.foundingMembersByEra?.[preset] ?? def.foundingMembers;
}

/** DB-backed foundedness for a single org (context + member presence). */
export async function isOrganizationFoundedLive(
  db: Db,
  def: Pick<InternationalOrganizationDef, "id" | "foundedYear" | "dissolvedYear">
): Promise<boolean> {
  if (def.foundedYear == null) return true;
  const { liveYear } = await loadOrgFoundingContext(db);
  const membershipsCol = await getOrganizationMembershipsCollection(db);
  const memberCount = await membershipsCol.countDocuments({ organizationId: def.id });
  return isOrganizationFounded({ def, liveYear, hasMembers: memberCount > 0 });
}
