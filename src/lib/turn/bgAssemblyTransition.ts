/**
 * A legacy Bulgarian ordinary chamber opens after its complete settled election.
 * processBgAssemblyTransition reconciles regions, government capacity and authority
 * in one required transaction; it preserves the existing mandate and financial records.
 */
import type { ClientSession, Db } from "mongodb";
import type { CountryGameState, Election, ElectedOfficial, GameState, State } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import { calendarTurn } from "@/lib/utils/gameDate";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  BG_ORDINARY_ASSEMBLY_SEATS,
  BG_ORDINARY_ASSEMBLY_START_TURN,
  BG_ORDINARY_ASSEMBLY_TOTAL_SEATS,
} from "@/lib/countries/bg/rules/assemblyTransition";
import {
  latestBgOrdinaryCohort,
  hasValidBgOrdinaryCustody,
} from "@/lib/countries/bg/rules/legacyAssemblyHandover";
type Calendar = Pick<GameState, "preset" | "preIteration" | "preIterationTurns">;
function clock(game: Calendar, turn: number) {
  return calendarTurn(turn, {
    preIterationActive: game.preIteration?.active,
    preIterationTurns: game.preIterationTurns,
  });
}
export async function processBgAssemblyTransition(
  db: Db,
  game: Calendar,
  turn: number,
  now: Date
): Promise<boolean> {
  if (game.preset !== "1991-default") return false;
  if (!Number.isSafeInteger(turn) || turn < 1 || !Number.isFinite(now.getTime()))
    throw new Error("Bulgarian handover needs a valid turn and time");
  if (clock(game, turn) < BG_ORDINARY_ASSEMBLY_START_TURN) return false;
  const ready = await db
    .collection<CountryGameState>("countryGameStates")
    .findOne({ _id: "BG" }, { projection: { bgOrdinaryAssemblySinceTurn: 1, dissolvedTurn: 1 } });
  if (!ready || ready.dissolvedTurn != null || ready.bgOrdinaryAssemblySinceTurn != null)
    return false;
  return runRequiredTransaction((session) => materializeBgLegacyHandover(db, turn, now, session), {
    client: db.client,
  });
}
async function materializeBgLegacyHandover(
  db: Db,
  turn: number,
  now: Date,
  session: ClientSession
): Promise<boolean> {
  if (!session.inTransaction()) throw new Error("Bulgarian handover requires a transaction");
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  if (game?.preset !== "1991-default" || clock(game, turn) < BG_ORDINARY_ASSEMBLY_START_TURN)
    return false;
  const countries = db.collection<CountryGameState>("countryGameStates");
  const country = await countries.findOne(
    { _id: "BG" },
    { session, projection: { bgOrdinaryAssemblySinceTurn: 1, dissolvedTurn: 1 } }
  );
  if (!country || country.dissolvedTurn != null || country.bgOrdinaryAssemblySinceTurn != null)
    return false;
  const regions = await db
    .collection<State>("states")
    .find({ countryId: "BG" }, { session, projection: { _id: 1 } })
    .toArray();
  const ids = regions.map((row) => String(row._id));
  if (
    ids.length !== Object.keys(BG_ORDINARY_ASSEMBLY_SEATS).length ||
    ids.some((id) => BG_ORDINARY_ASSEMBLY_SEATS[id] == null)
  )
    return false;
  const resolved = await db
    .collection<Election>("elections")
    .find(
      { countryId: "BG", electionType: "nationalAssembly", cycle: { $gte: 1 }, status: "resolved" },
      { session, projection: { state: 1, totalSeats: 1, cycle: 1 } }
    )
    .sort({ cycle: -1 })
    .limit(ids.length + 1)
    .toArray();
  const cohort = latestBgOrdinaryCohort(clock(game, turn), ids, resolved);
  if (!cohort) return false;
  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find(
      { countryId: "BG", officeType: "assemblyDeputy" },
      { session, projection: { seatsHeld: 1, characterId: 1, state: 1 } }
    )
    .toArray();
  if (
    !hasValidBgOrdinaryCustody(
      officials.map((row) => ({
        seatsHeld: row.seatsHeld,
        regionId: row.state,
        playerId: row.characterId?.toHexString(),
      })),
      cohort.regionalSeats
    )
  )
    return false;
  const updated = await db.collection<State>("states").bulkWrite(
    ids.map((id) => ({
      updateOne: {
        filter: { _id: id, countryId: "BG" },
        update: { $set: { houseDistricts: cohort.regionalSeats[id] } },
      },
    })),
    { session }
  );
  if (updated.matchedCount !== ids.length) throw new Error("Bulgarian handover regions changed");
  const formation = await db.collection<GovernmentFormation>("governmentFormations").updateOne(
    { _id: "BG" },
    {
      $set: {
        totalSeats: BG_ORDINARY_ASSEMBLY_TOTAL_SEATS,
        majorityThreshold: Math.floor(BG_ORDINARY_ASSEMBLY_TOTAL_SEATS / 2) + 1,
        updatedAt: now,
      },
    },
    { session }
  );
  if (formation.matchedCount !== 1) throw new Error("Bulgarian handover government is missing");
  const marked = await countries.updateOne(
    {
      _id: "BG",
      bgOrdinaryAssemblySinceTurn:
        country.bgOrdinaryAssemblySinceTurn === undefined
          ? { $exists: false }
          : country.bgOrdinaryAssemblySinceTurn,
    },
    { $set: { bgOrdinaryAssemblySinceTurn: turn, updatedAt: now } },
    { session }
  );
  if (marked.modifiedCount !== 1) throw new Error("Bulgarian handover authority changed");
  return true;
}
