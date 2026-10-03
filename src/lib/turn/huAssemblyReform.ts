import type { Db } from "mongodb";
import type { State, ElectedOfficial, Election, CountryGameState } from "@/lib/db/types";
import type { GameState } from "@/lib/db/types/gameState";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { apportionSeats as apportionRegionSeats } from "@/lib/seeds/reference/rules/apportionSeats";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";

export const HU_REFORM_YEAR = 2014;
export const HU_REFORM_SEATS = 199;

export function hu2014RegionSeats(regions: State[]): Record<string, number> {
  if (regions.length === 0 || regions.some((region) => !(region.population > 0))) {
    throw new Error("HU assembly reform requires populated Hungarian regions");
  }
  const ordered = [...regions].sort((left, right) =>
    String(left._id).localeCompare(String(right._id))
  );
  return apportionRegionSeats(
    HU_REFORM_SEATS,
    Object.fromEntries(ordered.map((region) => [String(region._id), region.population]))
  );
}

/**
 * An authorized Hungarian modern election replaces the sitting Assembly only
 * after a complete 199-seat result is already seated. Capacity, government and
 * the completion marker change together; no deputy is assigned invented seats.
 */
export async function runHuAssemblyReform(
  db: Db,
  currentYear: number,
  now: Date
): Promise<boolean> {
  if (currentYear < 2012) return false;
  const game = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1, huAssemblyReformedAtYear: 1 } });
  if (game?.preset !== "1991-default" || game.huAssemblyReformedAtYear != null) return false;
  const country = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "HU" }, { projection: { huElectoralSystem2011SinceTurn: 1 } });
  if (country?.huElectoralSystem2011SinceTurn == null) return false;
  return runRequiredTransaction(
    async (session) => {
      const current = await db
        .collection<GameState>("gameState")
        .findOne(
          { _id: "current" },
          { session, projection: { preset: 1, huAssemblyReformedAtYear: 1 } }
        );
      if (current?.preset !== "1991-default" || current.huAssemblyReformedAtYear != null)
        return false;
      const regions = await db
        .collection<State>("states")
        .find(
          { countryId: "HU" },
          { session, projection: { _id: 1, population: 1, houseDistricts: 1 } }
        )
        .toArray();
      const resolved = await db
        .collection<Election>("elections")
        .find(
          {
            countryId: "HU",
            electionType: "nationalAssembly",
            status: "resolved",
            "hungarianModernAssembly.ruleVersion": "mixed-2011-v1",
          },
          { session, projection: { state: 1, totalSeats: 1, cycle: 1 } }
        )
        .sort({ cycle: -1 })
        .limit(regions.length)
        .toArray();
      const capacities = new Map(resolved.map((row) => [row.state, row.totalSeats]));
      if (
        regions.length !== 6 ||
        resolved.length !== 6 ||
        capacities.size !== 6 ||
        new Set(resolved.map((row) => row.cycle)).size !== 1 ||
        !Number.isSafeInteger(resolved[0]?.cycle) ||
        resolved[0].cycle < 1 ||
        resolved.some(
          (row) => !Number.isSafeInteger(row.totalSeats) || (row.totalSeats ?? 0) < 1
        ) ||
        resolved.reduce((sum, row) => sum + (row.totalSeats ?? 0), 0) !== HU_REFORM_SEATS ||
        regions.some((region) => !capacities.has(String(region._id)))
      )
        return false;
      const officials = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find(
          {
            countryId: "HU",
            officeType: getLowerChamberOfficeType("HU", "1991-default"),
          },
          { session, projection: { _id: 1, state: 1, seatsHeld: 1, characterId: 1 } }
        )
        .toArray();
      if (
        officials.some(
          (row) =>
            !Number.isSafeInteger(row.seatsHeld ?? 1) ||
            (row.seatsHeld ?? 1) < 0 ||
            (row.characterId != null && (row.seatsHeld ?? 1) > 1) ||
            !row.state ||
            !capacities.has(row.state)
        )
      )
        return false;
      for (const region of regions) {
        const installed = officials
          .filter((row) => row.state === String(region._id))
          .reduce((sum, row) => sum + (row.seatsHeld ?? 1), 0);
        if (installed !== capacities.get(String(region._id))) return false;
      }
      // Lock the already installed mandates against concurrent seat changes.
      await db
        .collection<ElectedOfficial>("electedOfficials")
        .updateMany(
          { _id: { $in: officials.map((row) => row._id) } },
          { $set: { updatedAt: now } },
          { session }
        );
      await db.collection<State>("states").bulkWrite(
        regions.map((region) => ({
          updateOne: {
            filter: { _id: region._id },
            update: { $set: { houseDistricts: capacities.get(String(region._id)) } },
          },
        })),
        { session }
      );
      await db
        .collection<GovernmentFormation>("governmentFormations")
        .updateOne(
          { _id: "HU" },
          { $set: { totalSeats: HU_REFORM_SEATS, majorityThreshold: 100, updatedAt: now } },
          { session }
        );
      const changed = await db
        .collection<GameState>("gameState")
        .updateOne(
          { _id: "current", huAssemblyReformedAtYear: { $exists: false } },
          { $set: { huAssemblyReformedAtYear: currentYear, updatedAt: now } },
          { session }
        );
      if (changed.modifiedCount !== 1) throw new Error("Hungarian Assembly completion changed");
      return true;
    },
    { client: db.client }
  );
}
