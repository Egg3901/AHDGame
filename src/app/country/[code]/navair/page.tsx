import { notFound } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { NAVAL_MISSIONS, AIR_MISSIONS } from "@/lib/navair/config";
import { NAVAL_MISSIONS_ORDERABLE, AIR_MISSIONS_ORDERABLE } from "@/lib/navair/missions";
import {
  REGIONS,
  region as regionOf,
  isWaterAccessible,
  isNavigable,
  within,
} from "@/lib/navair/map";
import {
  NavairCommandClient,
  type CommandFormation,
  type MissionOption,
  type StationOption,
} from "./NavairCommandClient";
import { loadNavairChannels } from "@/lib/db/collections/navairChannels";
import { getConflictsCollection } from "@/lib/db/collections/conflicts";
import { conflictRegions } from "@/lib/military/conflictRegions";
import { channelKey } from "@/lib/navair/channels";
import { MIN_SUPPLY } from "@/lib/navair/config";
import { repairRate, isResting, isWithdrawing, freeRepairCeiling } from "@/lib/navair/repair";
import { basingStatus } from "@/lib/navair/basing";
import { loadMilitaryBlocs } from "@/lib/military/blocLookup";
import { getNationalArsenal } from "@/lib/db/collections/nationalArsenal";
import { REPAIR, type BasingKey } from "@/lib/navair/config";
import type { NavairUnit } from "@/lib/navair/types";
import type { FormationWarning, ForceSummary, RepairNote } from "./NavairCommandClient";
import { resolveCountryIdentity } from "@/lib/country/countryIdentity";

export const dynamic = "force-dynamic";

/**
 * Naval and air command for one country.
 *
 * One page for the whole force. A fleet belongs to a nation, not to a war, and the
 * decision a commander makes is how to spread a limited number of hulls and wings across
 * every place that wants them. Splitting this across individual conflict pages would make
 * that decision impossible to see.
 *
 * Force composition is command-tier sight. Only someone who actually commands this
 * nation's forces sees its dispositions; everyone else is told plainly that they do not,
 * rather than being shown a fleet they have no business seeing or controls that would be
 * refused by the API anyway.
 */
export default async function NavairCommandPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();

  // Same gate the rest of the military subsystem uses. With conflicts off there is no
  // war to command anything in.
  const gameState = await getGameState();
  if (!gameState?.conflictsEnabled) notFound();

  const positionId = DEFENSE_POSITION_BY_COUNTRY[countryId];
  if (!positionId) notFound();

  const db = await getDb();
  const authUser = await getAuthUserWithCharacter();
  const characterId = authUser?.character?._id ? String(authUser.character._id) : null;
  const isAdmin = authUser?.isAdmin === true;

  const holder = await getCabinetMembersCollection(db).findOne({ countryId, positionId });
  const holderId = holder?.characterId ? String(holder.characterId) : null;
  const commands = isAdmin || (!!characterId && characterId === holderId);

  const { name: countryName } = await resolveCountryIdentity(db, countryId);

  if (!commands) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-lg text-neutral-100">Naval and air command</h1>
        <p className="mt-1 text-sm text-neutral-400">{countryName}</p>
        <p className="mt-6 text-sm text-neutral-300">
          You do not command this nation&apos;s forces. Fleet and air dispositions are only visible
          to the officeholder.
        </p>
      </main>
    );
  }

  const units = (await getMilitaryUnitsCollection(db)
    .find({ countryId, domain: { $in: ["naval", "air"] } })
    .toArray()) as unknown as NavairUnit[];

  // What this force is actually achieving. Without it the page is a list of objects with
  // dropdowns, and a commander cannot tell what problem they are being asked to solve.
  const channels = await loadNavairChannels(db);
  const wars = await getConflictsCollection(db)
    .find(
      {
        status: "active",
        $or: [{ "sideA.countries": countryId }, { "sideB.countries": countryId }],
      },
      {
        projection: {
          name: 1,
          region: 1,
          extendedRegions: 1,
          "sideA.countries": 1,
          "sideB.countries": 1,
        },
      }
    )
    .toArray();

  const holding = REGIONS.map((r) => ({
    region: r.name,
    pct: channels.get(channelKey(countryId, r.id))?.seaControl ?? 0,
  }))
    .filter((h) => h.pct >= 20)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3);

  // A front is "getting air" if any of this country's wings is flying close air support
  // within reach of it. Reach mirrors the engine: bombers and transports two regions, the
  // rest one.
  const frontRegions = wars.flatMap((w) =>
    conflictRegions({ region: w.region, extendedRegions: w.extendedRegions })
  );
  const casReach = new Set<string>();
  for (const u of units) {
    if (u.domain !== "air" || u.mission !== "CAS" || !u.station) continue;
    const radius = u.type === "Bomber Squadron" || u.type === "Airlift Wing" ? 2 : 1;
    for (const r of within(u.station, radius)) casReach.add(r);
  }
  const frontsWithoutAir = [
    ...new Set(frontRegions.filter((r) => !casReach.has(r)).map((r) => regionOf(r)?.name ?? r)),
  ];

  const starving = units.filter((u) => (u.supply ?? 100) <= MIN_SUPPLY).length;

  // Basing decides both how fast a formation mends and how far free repair can carry it,
  // and basing depends on who this country is fighting. Same rosters the turn pass reads.
  const [blocs, arsenal] = await Promise.all([
    loadMilitaryBlocs(db),
    getNationalArsenal(db, countryId),
  ]);
  const enemyCountryIds = new Set(
    wars.flatMap((w) => {
      const doc = w as { sideA?: { countries?: string[] }; sideB?: { countries?: string[] } };
      const a = doc.sideA?.countries ?? [];
      const b = doc.sideB?.countries ?? [];
      return a.includes(countryId) ? b : a;
    })
  );

  const summary: ForceSummary = {
    holding,
    frontsWithoutAir,
    starving,
    atWar: wars.length > 0,
    navalLots: arsenal.stock.naval ?? 0,
    airLots: arsenal.stock.air ?? 0,
  };

  const formations: CommandFormation[] = units
    .map((u) => ({
      id: String(u._id),
      name: u.name,
      type: u.type,
      domain: u.domain as "naval" | "air",
      station: u.station ?? null,
      // A formation with no station yet is not lost: the turn phase places it. Saying so
      // beats showing a blank the player cannot act on.
      stationName: u.station ? (regionOf(u.station)?.name ?? u.station) : "Not yet deployed",
      mission: u.mission ?? null,
      missionTarget: u.missionTarget ?? null,
      integrity: u.integrity ?? 100,
      readiness: u.readiness,
      supply: u.supply ?? 100,
      auto: u.stationSetByPlayer !== true,
      warnings: warningsFor(u, frontRegions),
      repair: repairNoteFor(
        u,
        u.station ? basingStatus(u.station, countryId, blocs, enemyCountryIds) : "home"
      ),
    }))
    .sort((a, b) => a.stationName.localeCompare(b.stationName) || a.name.localeCompare(b.name));

  const navalMissions: MissionOption[] = NAVAL_MISSIONS_ORDERABLE.map((key) => ({
    key,
    label: NAVAL_MISSIONS[key].label,
    desc: NAVAL_MISSIONS[key].desc,
  }));
  const airMissions: MissionOption[] = AIR_MISSIONS_ORDERABLE.map((key) => ({
    key,
    label: AIR_MISSIONS[key].label,
    desc: AIR_MISSIONS[key].desc,
  }));

  const stations: StationOption[] = REGIONS.map((r) => ({
    id: r.id,
    name: r.name,
    allowed: isWaterAccessible(r.id) && isNavigable(r.id),
  })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-lg text-neutral-100">Naval and air command</h1>
      <p className="mt-1 text-sm text-neutral-400">{countryName}</p>

      <div className="mt-6">
        <NavairCommandClient
          summary={summary}
          countryCode={code}
          positionId={positionId}
          formations={formations}
          navalMissions={navalMissions}
          airMissions={airMissions}
          stations={stations}
        />
      </div>
    </main>
  );
}

/**
 * What is wrong with this formation that its commander could fix.
 *
 * Deliberately only things with an action attached. "Condition 65%" is a fact and needs no
 * warning; "out of supply because it is oceans from home" is a fact with a move attached,
 * and is the difference between a page that reports and a page that helps.
 */
function warningsFor(unit: NavairUnit, frontRegions: readonly string[]): FormationWarning[] {
  const out: FormationWarning[] = [];

  if ((unit.supply ?? 100) <= MIN_SUPPLY) {
    out.push({
      severity: "bad",
      text: "Out of supply: too far from home or based in unfriendly waters. It fights at a fraction of strength here.",
    });
  }

  if (unit.domain === "air" && unit.mission === "CAS" && unit.station) {
    const radius = unit.type === "Bomber Squadron" || unit.type === "Airlift Wing" ? 2 : 1;
    const reaches = within(unit.station, radius);
    if (frontRegions.length > 0 && !frontRegions.some((r) => reaches.includes(r))) {
      out.push({
        severity: "warn",
        text: "Flying close air support but cannot reach any front. Move it nearer the fighting or give it another job.",
      });
    }
  }

  if (unit.domain === "naval" && unit.mission === "PORT" && frontRegions.length > 0) {
    out.push({
      severity: "warn",
      text: "In port while a war is on. It contests nothing and closes no lane where it is.",
    });
  }

  return out;
}

/**
 * What this formation is recovering, in words a commander can act on.
 *
 * Deliberately states the RATE and the REASON rather than a status word. "Not mending" on
 * its own sends a player to the wiki; "your supply is below what a yard needs" sends them
 * to move the fleet, which is the decision this page exists to support.
 */
function repairNoteFor(unit: NavairUnit, basing: BasingKey): RepairNote {
  const integrity = unit.integrity ?? 100;
  // A formation being withdrawn mends in a yard whatever its standing order still says,
  // so both terms have to be read the way the turn pass reads them. Taking the stored
  // mission at face value here reported a fraction of the real rate against the wrong
  // limit, and a page that disagrees with the engine is worse than one that says nothing.
  const withdrawing = isWithdrawing(unit);
  const resting = withdrawing || isResting(unit);
  const ceiling = freeRepairCeiling(withdrawing ? "home" : basing, resting);
  const rate = repairRate(unit, resting);

  // Deliberately says nothing about having fought this turn, even though that does block
  // repair. `engaged` is set by `resolveEngagement` and never written to the database, so
  // it is always undefined here. It must STAY unpersisted: `persistCombatResults` only
  // writes formations it touched, so a stored `engaged: true` would never be cleared and
  // would block that hull's repair for ever.
  if (integrity >= 100) return { mending: false, text: "At full condition." };

  if (integrity >= ceiling) {
    return {
      mending: false,
      text: `Holding at ${Math.round(integrity)}%. Free repair reaches ${ceiling}% here. The rest needs a home base or materiel from the arsenal.`,
    };
  }

  if (rate <= 0) {
    return {
      mending: false,
      text: `Not mending: ${Math.round(unit.supply ?? 100)}% supply is below the ${REPAIR.minSupply}% repairs need. Move it nearer home, or lift supply with an Airlift wing.`,
    };
  }

  // A wing is not in a yard and does not put into port. The rates are identical across
  // the two domains; only the words differ, and getting them wrong is the kind of detail
  // that makes a player doubt the rest of the readout.
  const air = unit.domain === "air";
  const where = withdrawing
    ? air
      ? "at a home base"
      : "in a home yard"
    : resting
      ? air
        ? "stood down at base"
        : "in port"
      : "on station";
  const limited =
    (unit.supply ?? 100) < 100 ? `, limited by ${Math.round(unit.supply ?? 100)}% supply` : "";
  return {
    mending: true,
    text: `Mending ${Math.round(rate)}% a turn ${where}${limited}, up to ${ceiling}%.`,
  };
}
