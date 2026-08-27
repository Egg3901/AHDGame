import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { listCountryGenerals } from "@/lib/db/collections/characterGenerals";
import { getMilitaryCommandsCollection } from "@/lib/db/collections/militaryCommands";
import { getMilitaryFormations } from "@/lib/db/collections/militaryFormations";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { severFromChainOfCommand } from "@/lib/military/severFromChainOfCommand";
import type { Migration, MigrationResult } from "../types";

/**
 * Hand back the units and postings still held by generals who have left.
 *
 * Relocation never severed a commissioned general from the country they left, so
 * a character who emigrated kept whatever that country's army had given them. An
 * earlier migration cleared the command ROSTERS; this one clears what a roster
 * entry is not: the divisions assigned to them, and any conflict posting standing
 * in their name.
 *
 * The units are the part that costs a player something. A unit follows the general
 * it is assigned to, and that general is now a foreign national with no posting in
 * this country — so the unit cannot be sent anywhere, by anyone, ever. Production
 * had seven Russian warships in that state under a player who had moved to the
 * United Kingdom, and one British brigade under a player who had moved to the
 * United States: real force, permanently unable to reach a front.
 *
 * Runs the same `severFromChainOfCommand` that relocation and dismissal now use,
 * once per off-roster character, so the repair cannot describe a different outcome
 * than the code that prevents it recurring.
 *
 * Idempotent: a second run finds no off-roster holder and writes nothing.
 */
async function severEmigratedGenerals(db: Db, dryRun: boolean): Promise<MigrationResult> {
  // Every country that has ever had an army, from either side of the tie: a unit
  // can be assigned to somebody in a country that never built a command.
  const countryIds = [
    ...new Set([
      ...((await getMilitaryCommandsCollection(db).distinct("countryId")) as CountryId[]),
      ...((await getMilitaryUnitsCollection(db).distinct("countryId")) as CountryId[]),
    ]),
  ];

  const notes: string[] = [];
  let severed = 0;

  for (const countryId of countryIds) {
    const roster = new Set((await listCountryGenerals(db, countryId)).map((g) => g.id));

    const [assignedGeneralIds, org] = await Promise.all([
      getMilitaryUnitsCollection(db).distinct("assignedGeneralId", { countryId }),
      getMilitaryFormations(db, countryId),
    ]);
    const holders = new Set<string>([
      ...(assignedGeneralIds as (string | null)[]).filter((id): id is string => Boolean(id)),
      ...org.conflictAssignments.map((assignment) => assignment.generalCharacterId),
    ]);
    const offRoster = [...holders].filter((id) => !roster.has(id));
    if (offRoster.length === 0) continue;

    // Same refusal as the roster migration: a roster that reads as empty for a
    // reason a one-shot production write cannot see would hand this country's
    // entire army back to the General Staff.
    if (roster.size === 0) {
      notes.push(
        `${countryId}: SKIPPED — roster empty but ${offRoster.length} off-roster holder(s)`
      );
      continue;
    }

    for (const characterId of offRoster) {
      if (dryRun) {
        const units = await getMilitaryUnitsCollection(db).countDocuments({
          countryId,
          assignedGeneralId: characterId,
        });
        const postings = org.conflictAssignments.filter(
          (assignment) => assignment.generalCharacterId === characterId
        ).length;
        notes.push(
          `${countryId}: would sever ${characterId} — ${units} unit(s), ${postings} posting(s)`
        );
        severed += 1;
        continue;
      }
      const ties = await severFromChainOfCommand(db, countryId, characterId);
      if (!ties.changed) continue;
      notes.push(
        `${countryId}: severed ${characterId}${ties.led.length ? ` (vacated ${ties.led.join(", ")})` : ""}`
      );
      severed += 1;
    }
  }

  return {
    documentsScanned: countryIds.length,
    documentsUpdated: dryRun ? 0 : severed,
    notes: notes.length > 0 ? notes : ["no country held units or postings for a departed general"],
  };
}

export const migration: Migration = {
  id: "2026-08-26-sever-emigrated-generals",
  description:
    "Return units and conflict postings held by generals who have emigrated to the country's General Staff.",
  idempotent: true,
  execute: (db, ctx) => severEmigratedGenerals(db, ctx.dryRun),
};
