import type { Db } from "mongodb";
import type { State, ElectedOfficial, Election } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import { apportionSeats as apportionRegionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { apportionSeats as apportionOfficialSeats } from "@/lib/country/seatApportionment";

export const HU_REFORM_YEAR = 2014;
export const HU_REFORM_SEATS = 199;

/**
 * The 1991 world starts with the 386-seat Assembly elected in 1990. The 2014
 * reform reduced it to 199 seats. Reapportion the live regions from their live
 * populations, then scale each sitting regional delegation to its new size.
 * The guard is stamped last so a failed partial write can be retried.
 *
 * https://static.valasztas.hu/dyn/pv14/szavossz/en/l50_e.html
 */
export async function runHuAssemblyReform(
  db: Db,
  currentYear: number,
  now: Date
): Promise<boolean> {
  if (currentYear < HU_REFORM_YEAR) return false;
  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1, huAssemblyReformedAtYear: 1 } });
  if (gameState?.preset !== "1991-default" || gameState.huAssemblyReformedAtYear) return false;

  const regions = await db
    .collection<State>("states")
    .find({ countryId: "HU" }, { projection: { _id: 1, population: 1, houseDistricts: 1 } })
    .toArray();
  if (regions.length === 0 || regions.some((region) => !(region.population > 0))) {
    throw new Error("HU assembly reform requires populated Hungarian regions");
  }

  const orderedRegions = [...regions].sort((left, right) =>
    String(left._id).localeCompare(String(right._id))
  );
  const regionSeats = apportionRegionSeats(
    HU_REFORM_SEATS,
    Object.fromEntries(orderedRegions.map((region) => [String(region._id), region.population]))
  );
  const stateOps = orderedRegions.map((region) => ({
    updateOne: {
      filter: { _id: region._id },
      update: { $set: { houseDistricts: regionSeats[String(region._id)] } },
    },
  }));
  await db.collection<State>("states").bulkWrite(stateOps);

  // A race already in progress may resolve in this same turn, before the
  // perpetual-election spawner gets its next chance to heal seat counts.
  const liveElections = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "HU",
        electionType: { $in: ["nationalAssembly", "snap_nationalAssembly"] },
        status: { $in: ["active", "upcoming"] },
      },
      { projection: { _id: 1, state: 1, totalSeats: 1 } }
    )
    .toArray();
  const electionOps = liveElections.flatMap((election) => {
    const seats = election.state ? regionSeats[election.state] : undefined;
    if (!seats || election.totalSeats === seats) return [];
    return [
      {
        updateOne: {
          filter: { _id: election._id },
          update: { $set: { totalSeats: seats, updatedAt: now } },
        },
      },
    ];
  });
  if (electionOps.length > 0) {
    await db.collection<Election>("elections").bulkWrite(electionOps);
  }

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "HU", officeType: "nationalAssembly" },
      { projection: { _id: 1, state: 1, seatsHeld: 1 } }
    )
    .toArray();
  const byRegion = new Map<string, ElectedOfficial[]>();
  for (const official of officials) {
    const regionId = official.state;
    if (!regionId || regionSeats[regionId] === undefined) continue;
    const peers = byRegion.get(regionId) ?? [];
    peers.push(official);
    byRegion.set(regionId, peers);
  }
  const officialOps = [...byRegion].flatMap(([regionId, peers]) => {
    const shares = apportionOfficialSeats(
      Object.fromEntries(peers.map((official) => [String(official._id), official.seatsHeld ?? 1])),
      regionSeats[regionId]
    );
    return peers.map((official) => ({
      updateOne: {
        filter: { _id: official._id },
        update: { $set: { seatsHeld: shares[String(official._id)] ?? 0, updatedAt: now } },
      },
    }));
  });
  if (officialOps.length > 0) {
    await db.collection<ElectedOfficial>("electedOfficials").bulkWrite(officialOps);
  }

  await db
    .collection("governmentFormations")
    .updateOne(
      { _id: "HU" },
      { $set: { totalSeats: HU_REFORM_SEATS, majorityThreshold: 100, updatedAt: now } }
    );
  await db
    .collection<GameState>("gameState")
    .updateOne(
      { _id: "current", huAssemblyReformedAtYear: { $exists: false } },
      { $set: { huAssemblyReformedAtYear: HU_REFORM_YEAR, updatedAt: now } }
    );
  return true;
}
