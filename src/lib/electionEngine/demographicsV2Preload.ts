import type { Db, Filter } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { resolveVotingAgeEligible } from "@/lib/constants/votingAge";
import type { GameState } from "@/lib/db/types/gameState";
import type { RegionDemographics } from "@/lib/db/types/regionDemographics";
import type { State } from "@/lib/db/types/state";
import { RESET_V2_READY } from "@/lib/resetVersions/availability";
import { resetSystemVersionsForCountry } from "@/lib/resetVersions/rules";

export interface DemographicsV2Preload {
  regionDemographicsByState: Map<string, RegionDemographics>;
  demographicsV2Countries: Set<string>;
  votingAgeByCountry: Map<string, number>;
}

const REGION_DEMOGRAPHICS_PROJECTION = {
  _id: 1,
  countryId: 1,
  ages: 1,
  lastUpdated: 1,
} as const;

function aggregateRegionDemographics(
  countryId: CountryId,
  rows: RegionDemographics[]
): RegionDemographics | null {
  if (rows.length === 0) return null;
  const male = Array<number>(101).fill(0);
  const female = Array<number>(101).fill(0);
  for (const row of rows) {
    for (let age = 0; age <= 100; age++) {
      male[age] += row.ages.male[age] ?? 0;
      female[age] += row.ages.female[age] ?? 0;
    }
  }
  const latestTimestamp = Math.max(
    0,
    ...rows.map((row) =>
      row.lastUpdated instanceof Date && Number.isFinite(row.lastUpdated.getTime())
        ? row.lastUpdated.getTime()
        : 0
    )
  );
  return {
    _id: countryId,
    countryId,
    ages: { male, female },
    lastUpdated: new Date(latestTimestamp),
  };
}

/**
 * Load the live population stock for a standalone tally. V1 worlds perform no
 * population read. Nationwide tallies receive the same aggregate used by the
 * batched turn path rather than silently falling back to static age shares.
 */
export async function loadElectionRegionDemographicsV2(input: {
  db: Db;
  countryId: CountryId;
  stateId: string;
  gameState: GameState | null;
}): Promise<RegionDemographics | null> {
  if (
    resetSystemVersionsForCountry(input.gameState, RESET_V2_READY, input.countryId).demographics !==
    "v2"
  ) {
    return null;
  }

  const collection = input.db.collection<RegionDemographics>("regionDemographics");
  if (input.stateId !== input.countryId) {
    return collection.findOne(
      { _id: input.stateId, countryId: input.countryId },
      { projection: REGION_DEMOGRAPHICS_PROJECTION }
    );
  }

  const rows = await collection
    .find({ countryId: input.countryId }, { projection: REGION_DEMOGRAPHICS_PROJECTION })
    .toArray();
  return aggregateRegionDemographics(input.countryId, rows);
}

export function loadElectionDemographicsGameState(db: Db): Promise<GameState | null> {
  return db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        preset: 1,
        currentYear: 1,
        currentTurn: 1,
        startingYear: 1,
        eraSystemEnabled: 1,
        votingAgeEligible: 1,
        votingAgeEligibleByCountry: 1,
        resetWorldId: 1,
        resetVersionSeeds: 1,
        demographicsSystemVersion: 1,
      },
    }
  );
}

/** Load v2's live population stock once for an entire election sweep. */
export async function loadDemographicsV2Preload(input: {
  db: Db;
  countries: CountryId[];
  regionFilter: Filter<RegionDemographics>;
  states: State[];
  nationwideCountries: CountryId[];
  gameState: GameState | null;
}): Promise<DemographicsV2Preload> {
  const demographicsV2Countries = new Set(
    input.countries.filter(
      (countryId) =>
        resetSystemVersionsForCountry(input.gameState, RESET_V2_READY, countryId).demographics ===
        "v2"
    )
  );
  const regionRows =
    demographicsV2Countries.size > 0
      ? await input.db
          .collection<RegionDemographics>("regionDemographics")
          .find(
            {
              $and: [
                input.regionFilter,
                { countryId: { $in: [...demographicsV2Countries] as CountryId[] } },
              ],
            },
            { projection: REGION_DEMOGRAPHICS_PROJECTION }
          )
          .toArray()
      : [];
  const regionDemographicsByState = new Map(regionRows.map((row) => [row._id as string, row]));

  for (const countryId of input.nationwideCountries) {
    if (!demographicsV2Countries.has(countryId)) continue;
    const stateIds = new Set(
      input.states.filter((state) => state.countryId === countryId).map((state) => state._id)
    );
    const rows = regionRows.filter((row) => stateIds.has(row._id));
    if (rows.length === 0) continue;
    const aggregate = aggregateRegionDemographics(countryId, rows);
    if (aggregate) regionDemographicsByState.set(countryId, aggregate);
  }

  return {
    regionDemographicsByState,
    demographicsV2Countries,
    votingAgeByCountry: new Map(
      input.countries.map((countryId) => [
        countryId,
        resolveVotingAgeEligible(
          input.gameState ?? undefined,
          input.gameState?.currentYear,
          countryId
        ),
      ])
    ),
  };
}
