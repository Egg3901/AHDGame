/**
 * Failed Duma ballots reopen together while successful results remain certified.
 * materializeRussianDumaRepeatOpening freezes fresh registers and a new campaign
 * atomically, binding each generation to its immutable predecessor receipt.
 */
import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  CountryGameState,
  Election,
  GameState,
  State,
  StateRegistrationPool,
} from "@/lib/db/types";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import {
  RUSSIAN_DUMA_RESULTS_COLLECTION,
  type RussianDumaResultRecord,
} from "./dumaElectionResult";
import { pendingRussianDumaRepeatBallots } from "./rules/assemblyCohort";
import { freezeRussianDumaElectorate } from "./rules/assemblyElectorate";
import { planRussianDumaDistricts } from "./rules/assemblyDistricts";
import { planRussianDumaBallot } from "./rules/assemblySchedule";
import { hasAuthorizedPostSovietTransition } from "./rules/postSovietTransition";

export const RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION = "russianDumaRepeatOpenings";
export interface RussianDumaRepeatOpeningRecord {
  _id: string;
  rootCohortId: ObjectId;
  cohortId: ObjectId;
  previousResultId: string;
  generation: number;
  mandateSinceTurn: number;
  openedOnTurn: number;
  createdAt: Date;
  electionIds: ObjectId[];
  seatIds: string[];
  npcAdmission?: {
    completedOnTurn: number;
    unrepresentedParties: string[];
    createdCandidates: number;
  };
}

export async function materializeRussianDumaRepeatOpening(input: {
  db: Db;
  session: ClientSession;
  rootCohortId: ObjectId;
  previousResultId: string;
  cohortId: ObjectId;
  electionIds: readonly ObjectId[];
  turn: number;
  now: Date;
}): Promise<{ record: RussianDumaRepeatOpeningRecord; created: boolean } | null> {
  const { db, session, rootCohortId, previousResultId, cohortId, electionIds, turn, now } = input;
  if (
    !session.inTransaction() ||
    !Number.isSafeInteger(turn) ||
    turn < 1 ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Duma repeats need a transaction, turn and time");
  const game = await db
    .collection<GameState>("gameState")
    .findOne(
      { _id: "current" },
      { session, projection: { preset: 1, preIteration: 1, preIterationTurns: 1 } }
    );
  if (game?.preset !== "1991-default") return null;
  const country = await db.collection<CountryGameState>("countryGameStates").findOne(
    { _id: "RU" },
    {
      session,
      projection: {
        ruFirstDumaElectionCohortId: 1,
        ruSovietSuccessionSinceTurn: 1,
        ruFederalAssemblyMandateSinceTurn: 1,
        ruFederalAssemblySinceTurn: 1,
      },
    }
  );
  if (
    !country?.ruFirstDumaElectionCohortId?.equals(rootCohortId) ||
    !hasAuthorizedPostSovietTransition(
      turn,
      country.ruSovietSuccessionSinceTurn,
      country.ruFederalAssemblyMandateSinceTurn
    )
  )
    throw new Error("Duma repeat mandate changed");
  const previous = await db
    .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
    .findOne({ _id: previousResultId }, { session });
  if (
    !previous ||
    previous.countryId !== "RU" ||
    previous.preset !== "1991-default" ||
    previous.mandateSinceTurn !== country.ruFederalAssemblyMandateSinceTurn ||
    !(previous.rootCohortId ?? previous.cohortId).equals(rootCohortId) ||
    previous._id !== previous.cohortId.toHexString() ||
    !Number.isSafeInteger(previous.resolvedOnTurn) ||
    previous.resolvedOnTurn < 1 ||
    previous.resolvedOnTurn > turn ||
    previous.seatedOnTurn != null
  )
    throw new Error("Duma repeats need an unseated certified predecessor");
  if (!previous.ballots)
    throw new Error("An older Duma receipt needs verified ballot recovery before repeats");
  const previousGeneration = previous.generation ?? 0;
  if (
    !Number.isSafeInteger(previousGeneration) ||
    previousGeneration < 0 ||
    previousGeneration >= Number.MAX_SAFE_INTEGER ||
    (previousGeneration === 0 &&
      (!previous.cohortId.equals(rootCohortId) || previous.rootCohortId != null))
  )
    throw new Error("Duma repeat generation identity changed");
  const openings = db.collection<RussianDumaRepeatOpeningRecord>(
    RUSSIAN_DUMA_REPEAT_OPENINGS_COLLECTION
  );
  if (previousGeneration > 0) {
    const binding = await openings.findOne(
      { _id: `${rootCohortId.toHexString()}:repeat:${previousGeneration}` },
      { session }
    );
    if (
      !binding?.cohortId.equals(previous.cohortId) ||
      !binding.rootCohortId.equals(rootCohortId) ||
      binding.mandateSinceTurn !== previous.mandateSinceTurn
    )
      throw new Error("Duma predecessor has no matching generation opening");
  }
  const generation = previousGeneration + 1;
  const id = `${rootCohortId.toHexString()}:repeat:${generation}`;
  const replay = await openings.findOne({ _id: id }, { session });
  if (replay) {
    if (
      replay.previousResultId !== previousResultId ||
      !replay.rootCohortId.equals(rootCohortId) ||
      replay.mandateSinceTurn !== previous.mandateSinceTurn
    )
      throw new Error("Duma repeat opening identity changed");
    return { record: replay, created: false };
  }
  if (country.ruFederalAssemblySinceTurn != null)
    throw new Error("The first Duma has already handed over");
  const pending = pendingRussianDumaRepeatBallots(previous.ballots);
  if (!pending.length) return null;
  if (
    electionIds.length !== pending.length ||
    new Set(electionIds.map((id) => id.toHexString())).size !== pending.length ||
    cohortId.equals(rootCohortId) ||
    cohortId.equals(previous.cohortId) ||
    previous.ballots.some((ballot) => !ObjectId.isValid(ballot.id)) ||
    electionIds.some((id) => previous.ballots!.some((ballot) => ballot.id === id.toHexString()))
  )
    throw new Error("Duma repeats need distinct new ballot identities");
  const regions = await db
    .collection<State>("states")
    .find(
      { countryId: "RU" },
      { session, projection: { _id: 1, population: 1, votingEligiblePopulation: 1 } }
    )
    .toArray();
  const pools = await db
    .collection<StateRegistrationPool>("stateRegistrationPool")
    .find({ countryId: "RU" }, { session, projection: { stateId: 1, unregistered: 1 } })
    .toArray();
  if (new Set(pools.map((row) => row.stateId)).size !== pools.length)
    throw new Error("Duplicate Duma registration pools");
  const register = freezeRussianDumaElectorate(
    regions.map((row) => ({
      id: String(row._id),
      population: row.population,
      votingEligiblePopulation: row.votingEligiblePopulation,
    })),
    Object.fromEntries(pools.map((row) => [row.stateId, row.unregistered]))
  );
  const districts = new Map(planRussianDumaDistricts(register).map((row) => [row.seatId, row]));
  const timing = planRussianDumaBallot(turn);
  const clock = {
    preIterationActive: game.preIteration?.active,
    preIterationTurns: game.preIterationTurns,
  };
  const ballots: Election[] = pending.map((old, index) => ({
    _id: electionIds[index],
    countryId: "RU",
    electionType: "dumaDeputy",
    cycle: 1,
    state: old.regionId,
    seatId: old.seatId,
    totalSeats: old.tier === "list" ? 225 : 1,
    electionYear: turnToGameMonth(calendarTurn(timing.endTurn, clock), 1991).year,
    status: "active",
    ...timing,
    startTime: now,
    primaryEndTime: new Date(now.getTime() + (timing.primaryEndTurn - turn) * MS_PER_TURN),
    endTime: new Date(now.getTime() + (timing.endTurn - turn) * MS_PER_TURN),
    createdAt: now,
    updatedAt: now,
    russianDumaRound: {
      cohortId,
      rootCohortId,
      generation,
      predecessorElectionId: new ObjectId(old.id),
      mandateSinceTurn: previous.mandateSinceTurn,
      tier: old.tier,
      registeredVoters:
        old.tier === "list"
          ? Object.values(register).reduce((sum, count) => sum + count, 0)
          : districts.get(old.seatId)!.registeredVoters,
      ...(old.tier === "constituency"
        ? { regionalDistrictCount: districts.get(old.seatId)!.regionalDistrictCount }
        : {}),
    },
  }));
  const record: RussianDumaRepeatOpeningRecord = {
    _id: id,
    rootCohortId,
    cohortId,
    previousResultId,
    generation,
    mandateSinceTurn: previous.mandateSinceTurn,
    openedOnTurn: turn,
    createdAt: now,
    electionIds: [...electionIds],
    seatIds: pending.map((row) => row.seatId),
  };
  await db.collection<Election>("elections").insertMany(ballots, { session });
  await openings.insertOne(record, { session });
  const bound = await db.collection<CountryGameState>("countryGameStates").updateOne(
    {
      _id: "RU",
      ruFirstDumaElectionCohortId: rootCohortId,
      ruFederalAssemblyMandateSinceTurn: previous.mandateSinceTurn,
      ruFederalAssemblySinceTurn: { $exists: false },
    },
    { $set: { updatedAt: now } },
    { session }
  );
  if (bound.matchedCount !== 1) throw new Error("Duma repeat mandate changed during opening");
  return { record, created: true };
}

export async function openRussianDumaRepeat(
  input: Omit<
    Parameters<typeof materializeRussianDumaRepeatOpening>[0],
    "session" | "cohortId" | "electionIds"
  >
) {
  // One preflight read sizes the id batch. The transaction rereads and validates the immutable receipt.
  const previous = await input.db
    .collection<RussianDumaResultRecord>(RUSSIAN_DUMA_RESULTS_COLLECTION)
    .findOne({ _id: input.previousResultId }, { projection: { ballots: 1 } });
  if (!previous?.ballots) throw new Error("Duma repeats need preserved predecessor ballots");
  const electionIds = pendingRussianDumaRepeatBallots(previous.ballots).map(() => new ObjectId());
  const cohortId = new ObjectId();
  return runRequiredTransaction(
    (session) => materializeRussianDumaRepeatOpening({ ...input, session, cohortId, electionIds }),
    { client: input.db.client }
  );
}
