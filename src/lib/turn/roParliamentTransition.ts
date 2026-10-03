import type { Db } from "mongodb";
import type { CountryGameState, ElectedOfficial, Election, GameState, State } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { calendarTurn } from "@/lib/utils/gameDate";
import { apportionSeats } from "@/lib/country/seatApportionment";
import {
  RO_1992_DEPUTIES_BY_REGION,
  RO_1992_DEPUTY_SEATS,
  RO_1992_SENATORS_BY_REGION,
} from "@/lib/countries/ro/rules/parliament1992";

/**
 * Seat the parliament returned by the September 1992 election once both
 * regional slates have resolved. The game places that vote at year-end turn 96.
 * The marker is last: interrupted writes repeat deterministically next turn.
 * Official records are reconciled to the new regional magnitudes even if a
 * partial resolution left an old delegation in place.
 * https://legislatie.just.ro/public/DetaliiDocument/94779
 * https://legislatie.just.ro/public/DetaliiDocument/94780
 */
export async function processRoParliamentTransition(
  db: Db,
  gameState: Pick<GameState, "preset" | "preIteration" | "preIterationTurns">,
  currentTurn: number,
  now: Date
): Promise<boolean> {
  if (gameState.preset !== "1991-default") return false;
  if (
    calendarTurn(currentTurn, {
      preIterationActive: gameState.preIteration?.active,
      preIterationTurns: gameState.preIterationTurns,
    }) < 96
  )
    return false;

  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "RO" },
    { projection: { roParliament1992SinceTurn: 1, roElectoralLaw1992SinceTurn: 1 } }
  );
  if (
    !country ||
    country.roParliament1992SinceTurn != null ||
    country.roElectoralLaw1992SinceTurn == null
  )
    return false;

  const regions = await db
    .collection<State>("states")
    .find({ countryId: "RO" }, { projection: { _id: 1 } })
    .toArray();
  const regionIds = regions.map((region) => String(region._id));
  if (
    regionIds.length !== Object.keys(RO_1992_DEPUTIES_BY_REGION).length ||
    regionIds.some((id) => RO_1992_DEPUTIES_BY_REGION[id] == null)
  )
    return false;

  const slates = await db
    .collection<Election>("elections")
    .find(
      {
        countryId: "RO",
        electionType: { $in: ["chamberOfDeputies", "senat"] },
        cycle: { $gte: 1 },
        status: "resolved",
      },
      { projection: { cycle: 1, electionType: 1, state: 1, totalSeats: 1 } }
    )
    .toArray();
  const complete = [...new Set(slates.map((row) => row.cycle))].some((cycle) =>
    (
      [
        ["chamberOfDeputies", RO_1992_DEPUTIES_BY_REGION],
        ["senat", RO_1992_SENATORS_BY_REGION],
      ] as const
    ).every(([chamber, expected]) => {
      const rows = slates.filter((row) => row.cycle === cycle && row.electionType === chamber);
      return (
        rows.length === regionIds.length &&
        new Set(rows.map((row) => row.state)).size === regionIds.length &&
        rows.every((row) => expected[row.state] === row.totalSeats)
      );
    })
  );
  if (!complete) return false;

  await db.collection<State>("states").bulkWrite(
    regionIds.map((id) => ({
      updateOne: {
        filter: { _id: id, countryId: "RO" },
        update: {
          $set: {
            houseDistricts: RO_1992_DEPUTIES_BY_REGION[id],
            stateSenateSeats: RO_1992_SENATORS_BY_REGION[id],
          },
        },
      },
    }))
  );

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "RO", officeType: { $in: ["deputy", "senator"] } },
      { projection: { _id: 1, state: 1, officeType: 1, seatsHeld: 1 } }
    )
    .toArray();
  const officialOps = regionIds.flatMap((regionId) =>
    (
      [
        ["deputy", RO_1992_DEPUTIES_BY_REGION],
        ["senator", RO_1992_SENATORS_BY_REGION],
      ] as const
    ).flatMap(([officeType, target]) => {
      const peers = officials.filter(
        (official) => official.state === regionId && official.officeType === officeType
      );
      if (peers.length === 0 || peers.every((official) => !((official.seatsHeld ?? 0) > 0)))
        return [];
      const shares = apportionSeats(
        Object.fromEntries(
          peers.map((official) => [String(official._id), official.seatsHeld ?? 0])
        ),
        target[regionId]
      );
      return peers.map((official) => ({
        updateOne: {
          filter: { _id: official._id },
          update: { $set: { seatsHeld: shares[String(official._id)] ?? 0, updatedAt: now } },
        },
      }));
    })
  );
  if (officialOps.length > 0)
    await db.collection<ElectedOfficial>("electedOfficials").bulkWrite(officialOps);

  await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: "RO" },
    {
      $set: {
        totalSeats: RO_1992_DEPUTY_SEATS,
        majorityThreshold: Math.floor(RO_1992_DEPUTY_SEATS / 2) + 1,
        updatedAt: now,
      },
    }
  );
  await countries.updateOne(
    { _id: "RO", roParliament1992SinceTurn: { $exists: false } },
    { $set: { roParliament1992SinceTurn: currentTurn, updatedAt: now } }
  );
  return true;
}
