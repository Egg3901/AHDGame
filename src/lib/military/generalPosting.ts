import type { Db } from "mongodb";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";
import { getMilitaryFormations } from "@/lib/db/collections/militaryFormations";
import { getConflict } from "@/lib/db/collections/conflicts";
import type { CountryId } from "@/lib/constants/countries";

/** One line of a general's order of battle: a unit type and how many they lead. */
export interface GeneralForce {
  name: string;
  count: number;
}

/**
 * A general's real assignment, as opposed to the canned `SPEC_PROFILE` illustration
 * the profile used to render. Every field here is read from live state or is null;
 * nothing is invented. Terrain, weather and air support are deliberately absent —
 * the game models none of them, and showing plausible values for them is what made
 * a two-unit country appear to field twenty formations.
 */
export interface GeneralPosting {
  /** Order of battle, grouped by unit type, descending by count then name. */
  forces: GeneralForce[];
  /** Units led by this general. 0 when they command nothing. */
  unitCount: number;
  /** The theater command they lead, or null when they lead none. */
  formationName: string | null;
  /** The conflict they are posted to, or null when held in reserve. */
  theaterName: string | null;
  /** Whether they hold the Theater Commander billet at that conflict. */
  inCharge: boolean;
}

export const EMPTY_POSTING: GeneralPosting = {
  forces: [],
  unitCount: 0,
  formationName: null,
  theaterName: null,
  inCharge: false,
};

/**
 * Group units into an order of battle by type.
 *
 * Sorted by count descending, then name, so the heaviest formation reads first and
 * the order is stable between renders rather than following document order.
 */
export function groupForces(units: Array<{ type?: string | null }>): GeneralForce[] {
  const counts = new Map<string, number>();
  for (const u of units) {
    const name = u.type?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Load a general's live assignment.
 *
 * `assignedGeneralId` on a unit and `generalCharacterId` on a conflict assignment
 * are both the owning character's id, which is what ties the three collections
 * together here.
 */
export async function loadGeneralPosting(
  db: Db,
  characterId: string,
  countryId: string
): Promise<GeneralPosting> {
  const [units, commands, formations] = await Promise.all([
    getMilitaryUnitsCollection(db)
      .find({ countryId: countryId as CountryId, assignedGeneralId: characterId })
      .project({ type: 1 })
      .toArray(),
    getMilitaryCommands(db, countryId),
    getMilitaryFormations(db, countryId),
  ]);

  const led = commands.find(
    (c) => c.commandingGeneralId === characterId || c.commanderIds?.includes(characterId)
  );
  const posting = formations.conflictAssignments.find((a) => a.generalCharacterId === characterId);
  // A posting names a theater by id; resolve it so the page shows the war, not the key.
  const conflict = posting ? await getConflict(db, posting.theaterId) : null;

  return {
    forces: groupForces(units as Array<{ type?: string | null }>),
    unitCount: units.length,
    formationName: led?.name ?? null,
    theaterName: conflict?.name ?? null,
    inCharge: posting?.inCharge ?? false,
  };
}
