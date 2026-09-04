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
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { resolveCabinetOfficeVisibility } from "@/lib/cabinet/officeVisibility";
import { resolveSeatName } from "@/lib/cabinet/rosterEra";
import { resolveGameYear } from "@/lib/era/era";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import { CommandingGeneralClient, type DefenceOfficeLink } from "./CommandingGeneralClient";
import { unitsForCommandPage } from "./commandForce";
import { resolveCountryIdentity } from "@/lib/country/countryIdentity";

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
  const { name: countryName } = await resolveCountryIdentity(db, countryId);
  // The roster is loaded up front, not just to list generals: a command keeps its
  // `commandingGeneralId` when that character emigrates or is dismissed, so the
  // stored id alone is not authority. `requireCommandingGeneral` re-checks the same
  // roster, and a page that rendered levers the route then refuses would be worse
  // than the not-a-CG panel.
  const [commands, allGenerals] = await Promise.all([
    getMilitaryCommands(db, countryId),
    listCountryGenerals(db, countryId),
  ]);
  const commissionedHere = !!characterId && allGenerals.some((g) => g.id === characterId);
  const command = commissionedHere
    ? (commands.find((c) => c.commandingGeneralId === characterId) ?? null)
    : null;

  if (!command) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h1 className="mb-2 text-lg font-semibold text-foreground">Commanding General</h1>
          <p className="text-[13px] text-muted">
            You do not lead a command in {countryName}. The Secretary of Defense appoints a
            commanding general for each theater command.
          </p>
        </div>
      </div>
    );
  }

  const [org, rawUnits, activeConflicts] = await Promise.all([
    getMilitaryFormations(db, countryId),
    getMilitaryUnitsCollection(db).find({ countryId }).toArray(),
    listConflictsForCountry(db, countryId),
  ]);
  const conflicts = activeConflicts.map((c) => ({ id: c._id, name: c.name }));

  // Only this command's own generals are the CG's to employ.
  const inCommand = new Set(command.commanderIds);
  const generals = allGenerals.filter((g) => inCommand.has(g.id));
  // Units: the command's establishment PLUS everything that travels with one of
  // its generals. See unitsForCommandPage — a unit's front comes from its general,
  // not from which command holds it, and the two really do diverge in live data.
  const units = unitsForCommandPage(rawUnits, (u) => String(u._id), command).map((u) => ({
    ...u,
    _id: String(u._id),
  })) as unknown as MilitaryUnit[];

  // Where this command was BUILT. Offered only to a viewer the cabinet fog-of-war
  // gate would actually let in — a link to an office that answers "Office records
  // restricted" is worse than no link, and this page's own structure panel already
  // publishes the command itself. Resolved after the not-a-CG return, so only a
  // real Commanding General pays for the lookup.
  const defencePositionId = DEFENSE_POSITION_BY_COUNTRY[countryId] ?? null;
  let defenceOffice: DefenceOfficeLink | null = null;
  if (defencePositionId) {
    const defenceSeat = await getCabinetMembersCollection(db).findOne({
      countryId,
      positionId: defencePositionId,
    });
    const { canView } = await resolveCabinetOfficeVisibility(db, {
      countryId,
      holderCharacterId: defenceSeat?.characterId ?? null,
      viewerCharacterId: authUser?.character?._id ?? null,
      // Keyed by user, not character: a reigning monarch is an imperial character.
      viewerUserId: authUser?.userId ?? null,
      isAdmin: !!authUser?.isAdmin,
      preset: gameState.preset,
    });
    const positionDef = getCabinetPositions(countryId).find((p) => p.id === defencePositionId);
    if (canView && positionDef) {
      defenceOffice = {
        href: `/country/${code.toLowerCase()}/executive/cabinet/${defencePositionId}/office#commands`,
        seatName: resolveSeatName(positionDef, resolveGameYear(gameState)),
      };
    }
  }

  return (
    <CommandingGeneralClient
      countryCode={code.toLowerCase()}
      command={command}
      defenceOffice={defenceOffice}
      generals={generals}
      // The whole national roster, only so a unit led by another command's general
      // is named rather than reading as unled. Postings still use `generals`.
      unitLeaders={allGenerals}
      units={units}
      conflictAssignments={org.conflictAssignments}
      conflicts={conflicts}
    />
  );
}
