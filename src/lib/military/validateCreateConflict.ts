import type { ConflictSide } from "@/lib/db/types/conflict";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import { homeRegionOf } from "@/lib/military/regionTopology";

export interface ColdWarConflictDraft {
  name: string;
  /** The map anchor. Must be one of `hostEntities`. */
  hostCountry: WorldEntityId;
  /** Every third-party country in the theatre; at least one. */
  hostEntities: WorldEntityId[];
  sideA: ConflictSide;
  sideB: ConflictSide;
}

export type ValidationResult = { ok: true } | { ok: false; status: number; error: string };

const bad = (error: string): ValidationResult => ({ ok: false, status: 400, error });

/**
 * Every rule an admin-created Cold War Conflict must clear.
 *
 * Pure on purpose: `hostCountry` is a `WorldEntityId`, which is `string`, so widening it
 * removed all compile-time checking and the admin route is the ONLY writer. Keeping the
 * rules here means each is testable without a database or a request, and there is one
 * place to read them.
 */
export function validateColdWarConflict(
  draft: ColdWarConflictDraft,
  ctx: { knownEntityIds: ReadonlySet<string>; isCountryId: (id: string) => boolean }
): ValidationResult {
  if (!draft.name.trim()) return bad("A conflict needs a name.");

  if (draft.hostEntities.length === 0) {
    return bad("A proxy war needs at least one host country.");
  }

  // The anchor drives `region`, the map pin and COUNTRY_ANCHOR, so it must be one of the
  // countries actually in the theatre.
  if (!draft.hostEntities.includes(draft.hostCountry)) {
    return bad(`The map anchor ${draft.hostCountry} must be one of the host countries.`);
  }

  for (const host of draft.hostEntities) {
    if (!ctx.knownEntityIds.has(host)) {
      return bad(`${host} is not a world entity in this preset.`);
    }
    // buildConflict throws for a cold_war host with no region, because its "noa"
    // fallback would file the war in North America. Refuse here so the failure reaches
    // the admin as a message rather than a 500.
    if (!homeRegionOf(host)) {
      return bad(`${host} has no home region. Add a COUNTRY_HOME_REGION row first.`);
    }
  }

  for (const [name, side] of [
    ["Side A", draft.sideA],
    ["Side B", draft.sideB],
  ] as const) {
    if (!side.label.trim()) return bad(`${name} needs a label.`);
    if (!side.factionEntity) return bad(`${name} needs a faction entity.`);
    if (!ctx.knownEntityIds.has(side.factionEntity)) {
      return bad(`${name}'s faction ${side.factionEntity} is not a world entity.`);
    }
    // The sideOf/belligerentSideOf faction clause is exact-match, and the conflict
    // page's visibility tier relies on a faction never being a real country. Enforce it
    // at the only writer rather than leaving it an accident.
    if (ctx.isCountryId(side.factionEntity)) {
      return bad(`${name}'s faction id ${side.factionEntity} collides with a playable country.`);
    }
    if (side.tokenStrength != null && side.tokenStrength < 0) {
      return bad(`${name}'s token strength cannot be negative.`);
    }
  }

  // Both backers must be set and differ: a proxy war is two blocs backing two factions,
  // and `blocOfSides` reads "contested" from exactly that.
  if (!draft.sideA.backer || !draft.sideB.backer) {
    return bad("Both sides of a proxy war need a bloc backer.");
  }
  if (draft.sideA.backer === draft.sideB.backer) {
    return bad("The two sides must be backed by opposing blocs.");
  }

  return { ok: true };
}
