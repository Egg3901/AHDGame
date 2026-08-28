import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { NAVAL_MISSIONS, AIR_MISSIONS } from "@/lib/navair/config";
import { NAVAL_MISSIONS_ORDERABLE, AIR_MISSIONS_ORDERABLE } from "@/lib/navair/missions";
import { REGIONS, region as regionOf, isWaterAccessible, isNavigable } from "@/lib/navair/map";
import {
  NavairCommandClient,
  type CommandFormation,
  type MissionOption,
  type StationOption,
} from "./NavairCommandClient";
import type { NavairUnit } from "@/lib/navair/types";

export const dynamic = "force-dynamic";

/**
 * Naval and air command for one country.
 *
 * One page for the whole force. A fleet belongs to a nation, not to a war, and the
 * decision a commander makes is how to spread a limited number of hulls and wings across
 * every place that wants them. Splitting this across the individual conflict pages would
 * make that decision impossible to see.
 */
export default async function NavairCommandPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const countryId = code.toUpperCase() as CountryId;
  if (!COUNTRY_CONFIGS[countryId]) notFound();

  const positionId = DEFENSE_POSITION_BY_COUNTRY[countryId];
  if (!positionId) notFound();

  const db = await getDb();
  const units = (await getMilitaryUnitsCollection(db)
    .find({ countryId, domain: { $in: ["naval", "air"] } })
    .toArray()) as unknown as NavairUnit[];

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
      integrity: u.integrity ?? 100,
      readiness: u.readiness,
      supply: u.supply ?? 100,
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
      <p className="mt-1 text-sm text-neutral-400">{COUNTRY_CONFIGS[countryId].name}</p>

      <div className="mt-6">
        <NavairCommandClient
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
