import { requireConflictsEnabled } from "../_coldwar/gate";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getNationalDoctrine } from "@/lib/db/collections/nationalDoctrine";
import { getMilitaryFormations } from "@/lib/db/collections/militaryFormations";
import { getMilitaryCommands } from "@/lib/db/collections/militaryCommands";
import { loadGeneralsById } from "@/lib/db/collections/characterGenerals";
import { listPendingForCountry } from "@/lib/db/collections/battleDeclarations";
import { listBattleReportsForCountry } from "@/lib/db/collections/battleReports";
import { natMods } from "@/lib/military/doctrineTree";
import { listActiveConflicts } from "@/lib/db/collections/conflicts";
import { RESERVE_THEATER_ID } from "@/lib/military/theaters";
import { belligerentSideOf } from "@/lib/military/conflictVisibility";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { getGameState } from "@/lib/gameState";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { CountryId } from "@/lib/constants/countries";
import { occupationOf } from "@/lib/military/occupation";
import { regionCodesOfCountry } from "@/lib/maps/regionOwnership";
import { hostEntitiesOf } from "@/lib/military/hostEntities";
import { CombatCommandClient } from "./CombatCommandClient";
import type { BattleReportView, ConflictView } from "./useCombatState";
import { toBattleReportView } from "./battleReportView";

// Combat Command — order-of-battle + PvP theater-resolution surface. Gated by
// conflictsEnabled and styled to match the Cold-War themed island. Units + org come
// from live gameState; offensives are declared here and resolved on the turn tick
// against the target nation's real forces.
export default async function CombatCommandPage() {
  await requireConflictsEnabled();

  const authUser = await getAuthUserWithCharacter();
  const country = authUser?.character?.countryId ?? "US";

  const db = await getDb();
  const rawUnits = await getMilitaryUnitsCollection(db).find({ countryId: country }).toArray();
  // Serialize ObjectId → string for the client boundary; the combat client keys
  // units by String(_id), so a string _id is what it expects at runtime.
  const units = rawUnits.map((u) => ({ ...u, _id: String(u._id) })) as unknown as MilitaryUnit[];

  const gameState = await getGameState();
  const currentTurn = gameState?.currentTurn ?? 1;

  const [doctrine, org, generalsById, pending, reports, activeConflicts] = await Promise.all([
    getNationalDoctrine(db, country),
    getMilitaryFormations(db, country),
    loadGeneralsById(db, country),
    listPendingForCountry(db, country),
    listBattleReportsForCountry(db, country, 10),
    listActiveConflicts(db),
  ]);

  // A report's theater name comes from the live conflict it was fought at; a report
  // for a since-resolved conflict falls back to its id (reserve reads "Reserve").
  const conflictName = new Map(activeConflicts.map((c) => [c._id, c.name]));
  const theaterNameOf = (id: string) =>
    id === RESERVE_THEATER_ID ? "Reserve" : (conflictName.get(id) ?? id);

  const pendingDeclarations = pending.map((d) => ({
    theaterId: d.theaterId,
    targetCountry: d.targetCountry,
    declaredTurn: d.declaredTurn,
  }));

  // A report's ground change, from THIS viewer's side. `control` is side B's share of
  // the host, so side A gains when it FALLS. Null when the report predates the front
  // position being recorded — unknown, which must not be shown as a stalemate.
  const sideByConflict = new Map(
    activeConflicts.map((c) => [c._id, belligerentSideOf(c, country)] as const)
  );
  const groundFor = (r: (typeof reports)[number]): number | null => {
    if (r.controlBefore == null || r.controlAfter == null) return null;
    const side = sideByConflict.get(r.theaterId);
    if (!side) return null;
    const deltaB = r.controlAfter - r.controlBefore;
    return Math.round((side === "B" ? deltaB : -deltaB) * 10) / 10;
  };

  // Render each report from the viewer's perspective (offensive vs defensive).
  const reportViews: BattleReportView[] = reports.map((r) =>
    toBattleReportView(r, country, theaterNameOf(r.theaterId), groundFor(r))
  );

  // Territorial state for the fronts this nation actually has forces at — the war
  // room only ever renders those, and each one costs a region lookup. The host's
  // drawable regions and the shards holding their geometry are resolved here, so the
  // client fetches geometry only — never ownership, and never the enemy's ORDER OF
  // BATTLE. The opposing side's belligerent list does go down: it is public on every
  // conflict record page, and the war room's target picker has to be built from it.
  const engagedIds = new Set(units.map((u) => u.theaterId));
  const engagedConflicts = activeConflicts.filter((c) => engagedIds.has(c._id));
  // Every host of every engaged war, not just each war's anchor: a conflict is
  // fought over `hostEntities`, and the front line is placed as a share of the land
  // the map can see. Resolving the anchor alone drew half a two-host theatre and
  // measured the line against that half.
  //
  // Still deduped across the whole page, which is what the anchor-keyed version was
  // for: two wars hosted in the same country previously issued one states query each.
  const zoneHosts = [...new Set(engagedConflicts.flatMap((c) => hostEntitiesOf(c)))];
  const regionCodesByHost = new Map(
    await Promise.all(
      zoneHosts.map(async (host) => [host, await regionCodesOfCountry(db, host)] as const)
    )
  );
  const conflictViews: ConflictView[] = await Promise.all(
    engagedConflicts.map(async (c) => {
      const occ = occupationOf(c);
      const occupyingSide = occ.occupier === "A" ? c.sideA : occ.occupier === "B" ? c.sideB : null;
      const hostEntities = hostEntitiesOf(c) as string[];
      // Deduped: two hosts never share a region today, but the union is what the
      // map filters features against and a repeat would draw one Land twice.
      const hostRegionCodes = [
        ...new Set(hostEntities.flatMap((host) => regionCodesByHost.get(host) ?? [])),
      ];
      // Roster membership only — deliberately NOT `sideOf`'s backer fallback, which
      // would hand a non-belligerent a target list at a war it has no part in. The
      // declare route applies the same rule, so the picker cannot offer a target the
      // server will refuse.
      const ownSide = belligerentSideOf(c, country);
      // The enemy faction belongs in the picker too — in a proxy war it is the only
      // target there is, because those rosters start empty and a faction is never
      // enrolled into one. Without it a member who joined the war has nothing to
      // attack, though the declare route would accept the faction.
      const enemySide = ownSide === "A" ? c.sideB : ownSide === "B" ? c.sideA : null;
      const enemyCountries = enemySide
        ? [...enemySide.countries, ...(enemySide.factionEntity ? [enemySide.factionEntity] : [])]
        : [];
      const ownSpectrum =
        ownSide === "A"
          ? (c.sideA.backer ?? "neutral")
          : ownSide === "B"
            ? (c.sideB.backer ?? "neutral")
            : "neutral";
      return {
        id: c._id,
        name: c.name,
        hostCountry: c.hostCountry,
        control: c.control,
        sideALabel: c.sideA.label,
        sideBLabel: c.sideB.label,
        enemyCountries,
        occupier: occ.occupier,
        occupierCountry: occupyingSide?.countries[0] ?? null,
        ownSpectrum,
        hostEntities,
        hostRegionCodes,
      };
    })
  );

  // A Commanding General who has not posted their generals has nothing to declare
  // WITH — and this page cannot post them, by design. Without a pointer they are one
  // click from the war and cannot find the door, because postings live on the CG's
  // own page. Shown only while there is something to act on: a live conflict to post
  // to, and at least one general still unposted.
  const viewerCharId = authUser?.character?._id ? String(authUser.character._id) : null;
  const myCommand = viewerCharId
    ? ((await getMilitaryCommands(db, country)).find(
        (c) => c.commandingGeneralId === viewerCharId
      ) ?? null)
    : null;
  const posted = new Set(org.conflictAssignments.map((a) => a.generalCharacterId));
  const unpostedGenerals = myCommand
    ? myCommand.commanderIds.filter((id) => !posted.has(id)).length
    : 0;
  const cgHint =
    unpostedGenerals > 0 && conflictViews.length > 0
      ? {
          unpostedGenerals,
          href: `/country/${country.toLowerCase()}/general/commands`,
        }
      : null;

  return (
    <CombatCommandClient
      units={units}
      country={country}
      countryCode={country.toLowerCase()}
      positionId={DEFENSE_POSITION_BY_COUNTRY[country as CountryId] ?? ""}
      currentTurn={currentTurn}
      natMods={natMods(doctrine.adopted)}
      conflictAssignments={org.conflictAssignments}
      generalsById={generalsById}
      positions={org.positions}
      pendingDeclarations={pendingDeclarations}
      reports={reportViews}
      conflicts={conflictViews}
      cgHint={cgHint}
    />
  );
}
