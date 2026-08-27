import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import {
  getMilitaryCommands,
  getMilitaryCommandsCollection,
} from "@/lib/db/collections/militaryCommands";
import {
  getMilitaryFormations,
  getMilitaryFormationsCollection,
} from "@/lib/db/collections/militaryFormations";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { applyDismissal } from "./dismissal";

/** What a character was still holding in a country's army when they left it. */
export interface SeveredCommandTies {
  /**
   * Commands they LED, by name. The only tie worth naming back to the player: a
   * roster seat and a posting are the defence secretary's to reassign, but a
   * vacated command is a hole in the chain of command someone has to fill.
   */
  led: string[];
  /** True when anything at all was severed — i.e. any write happened. */
  changed: boolean;
}

/**
 * Take a character out of one country's chain of command.
 *
 * The country keeps nothing pointing at them: they leave every command roster,
 * any command they led loses its lead, their conflict postings go, and the units
 * assigned to them fall back to the General Staff in reserve.
 *
 * Two events need exactly this and used to implement it separately — or, in one
 * case, not at all:
 *
 *   - DISMISSAL. The defence secretary sacks a general. Already cascaded; this is
 *     that cascade, lifted out so it has one definition.
 *   - EMIGRATION. A commissioned general relocates to another country. Nothing
 *     severed anything, so the saved command kept their character id and every
 *     consequence followed from that: the office could not draw a row for someone
 *     its roster no longer held, the commands PUT refused every later edit over
 *     that id, and `requireCommandingGeneral` went on treating them as the lead —
 *     which handed a player who had moved abroad their old country's postings and
 *     Theater Commander picks. Production had two of these: Russia's only command
 *     and one of the United Kingdom's.
 *
 * The commission itself is NOT touched. `characterGenerals` carries no country and
 * a general's country is resolved from their character, so emigrating already moves
 * them onto their new country's roster; dismissal clears the commission separately,
 * where that is what the act means.
 *
 * Nobody is promoted to fill the gap. Severing a Theater Commander vacates that
 * front and authority falls back to the defence holder, which `canActAtTheater`
 * already handles — but the seat has quietly taken the front back and owes it a
 * successor.
 *
 * Idempotent, and writes nothing when the character held nothing: relocation runs
 * for every player, and the overwhelming majority never commanded anything.
 */
export async function severFromChainOfCommand(
  db: Db,
  countryId: CountryId,
  characterId: string
): Promise<SeveredCommandTies> {
  const [commands, org] = await Promise.all([
    getMilitaryCommands(db, countryId),
    getMilitaryFormations(db, countryId),
  ]);

  const onRoster = commands.filter((command) => command.commanderIds.includes(characterId));
  const postings = org.conflictAssignments.filter(
    (assignment) => assignment.generalCharacterId === characterId
  );
  // Counted before the write, and independently of the two above: a unit can be
  // assigned to a general who sits on no command at all.
  const units = await getMilitaryUnitsCollection(db).countDocuments({
    countryId,
    assignedGeneralId: characterId,
  });

  const ties: SeveredCommandTies = {
    led: onRoster
      .filter((command) => command.commandingGeneralId === characterId)
      .map((command) => command.name),
    changed: onRoster.length > 0 || postings.length > 0 || units > 0,
  };
  if (!ties.changed) return ties;

  const next = applyDismissal(commands, org.conflictAssignments, characterId);

  await Promise.all([
    getMilitaryCommandsCollection(db).updateOne(
      { countryId },
      { $set: { commands: next.commands }, $setOnInsert: { countryId } },
      { upsert: true }
    ),
    getMilitaryFormationsCollection(db).updateOne(
      { countryId },
      { $set: { conflictAssignments: next.assignments }, $setOnInsert: { countryId } },
      { upsert: true }
    ),
    // Their units keep no ghost leader: General Staff, and reserve rather than a
    // front. Reserve IS the reconciled home, because the postings that put them at
    // a front are dropped in the same operation — `theaterOfUnit` resolves an
    // unassigned unit to reserve anyway.
    getMilitaryUnitsCollection(db).updateMany(
      { countryId, assignedGeneralId: characterId },
      { $set: { assignedGeneralId: null, theaterId: "reserve" } }
    ),
  ]);

  return ties;
}
