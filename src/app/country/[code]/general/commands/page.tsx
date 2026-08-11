import { notFound } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";
import { getMilitaryFormations } from "@/lib/db/collections/militaryFormations";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { listCountryGenerals } from "@/lib/db/collections/characterGenerals";
import { listConflictsForCountry } from "@/lib/db/collections/conflicts";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { CommandingGeneralClient } from "./CommandingGeneralClient";

/**
 * The Commanding General's own page — where a CG employs the Command the defense
 * holder built for them: posting their generals to Conflicts and designating a
 * Theater Commander for each.
 *
 * Authority comes from being `commandingGeneralId` on a Command in this country,
 * not from any cabinet seat. Anyone else gets the not-a-CG state.
 */
export default async function CommandingGeneralPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();

  const gameState = await getGameState();
  if (!gameState?.conflictsEnabled) notFound();

  const authUser = await getAuthUserWithCharacter();
  const characterId = authUser?.character?._id ? String(authUser.character._id) : null;

  const db = await getDb();
  const commands = await getMilitaryCommands(db, countryId);
  const command = characterId
    ? (commands.find((c) => c.commandingGeneralId === characterId) ?? null)
    : null;

  if (!command) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h1 className="mb-2 text-lg font-semibold text-foreground">Commanding General</h1>
          <p className="text-[13px] text-muted">
            You do not lead a command in {COUNTRY_CONFIGS[countryId].name}. The Secretary of Defense
            appoints a commanding general for each theater command.
          </p>
        </div>
      </div>
    );
  }

  const [org, allGenerals, rawUnits, activeConflicts] = await Promise.all([
    getMilitaryFormations(db, countryId),
    listCountryGenerals(db, countryId),
    getMilitaryUnitsCollection(db).find({ countryId }).toArray(),
    listConflictsForCountry(db, countryId),
  ]);
  const conflicts = activeConflicts.map((c) => ({ id: c._id, name: c.name }));

  // Only this command's own generals and units are the CG's to employ.
  const inCommand = new Set(command.commanderIds);
  const generals = allGenerals.filter((g) => inCommand.has(g.id));
  const ownUnitIds = new Set(command.unitIds);
  const units = rawUnits
    .filter((u) => ownUnitIds.has(String(u._id)))
    .map((u) => ({ ...u, _id: String(u._id) })) as unknown as MilitaryUnit[];

  return (
    <CommandingGeneralClient
      countryCode={code.toLowerCase()}
      command={command}
      // Back to where this command was BUILT — the other half of the same concept.
      // Null for a country with no defence seat, in which case no link is offered.
      commandStructureHref={
        DEFENSE_POSITION_BY_COUNTRY[countryId]
          ? `/country/${code.toLowerCase()}/executive/cabinet/${DEFENSE_POSITION_BY_COUNTRY[countryId]}/office#commands`
          : null
      }
      generals={generals}
      units={units}
      conflictAssignments={org.conflictAssignments}
      conflicts={conflicts}
    />
  );
}
